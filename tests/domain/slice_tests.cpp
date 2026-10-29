#include "Sequence.h"
#include "SliceGrid.h"

#include <cmath>
#include <cstdio>

namespace {

int g_failed = 0;

void check(bool ok, const char* text, int line) {
    if (!ok) {
        std::printf("FAIL %s:%d  %s\n", "slice_tests.cpp", line, text);
        ++g_failed;
    }
}

#define CHECK(cond) check(static_cast<bool>(cond), #cond, __LINE__)

bool near(double a, double b) { return std::fabs(a - b) < 1e-9; }

void testGridDefaults() {
    const bt::SliceGrid grid;
    CHECK(near(grid.bpm(), 120.0));
    CHECK(grid.loopBeats() == 8);
    CHECK(grid.sliceExp() == 0);
    CHECK(near(grid.beatSec(), 0.5));
    CHECK(near(grid.sliceBeats(), 1.0));
    CHECK(near(grid.sliceSec(), 0.5));
    CHECK(near(grid.loopSec(), 4.0));
    CHECK(near(grid.remainderSec(), 0.0));
    CHECK(grid.slotCount() == 8);
}

void testGridDivisions() {
    bt::SliceGrid fine;
    fine.setLoop(32);
    fine.setSlice(-4);
    CHECK(near(fine.sliceBeats(), 1.0 / 16.0));
    CHECK(fine.slotCount() == 512);
    fine.setSlice(-6);
    CHECK(fine.sliceExp() == -4);

    bt::SliceGrid three;
    three.setLoop(3);
    three.setSlice(1);
    CHECK(three.slotCount() == 1);

    // 8-beat slices in a 12-beat loop: one slot, then four silent beats.
    bt::SliceGrid remainder;
    remainder.setLoop(12);
    remainder.setSlice(3);
    CHECK(remainder.sliceExp() == 3);
    CHECK(remainder.slotCount() == 1);
    CHECK(near(remainder.sliceSec(), 4.0));
    CHECK(near(remainder.loopSec(), 6.0));
    CHECK(near(remainder.remainderSec(), 2.0));

    const bt::PlayheadPosition inside = remainder.positionAt(7.9);
    CHECK(inside.slot == 0);
    CHECK(near(inside.localBeats, 7.9));
    const bt::PlayheadPosition tail = remainder.positionAt(8.0);
    CHECK(tail.slot == 1);
    CHECK(near(tail.localBeats, 0.0));
}

void testSliceShrinksToTheLoop() {
    bt::SliceGrid grid;
    grid.setLoop(16);
    grid.setSlice(4);
    CHECK(grid.sliceExp() == 4);
    CHECK(grid.slotCount() == 1);

    grid.setLoop(12);
    CHECK(grid.loopBeats() == 12);
    CHECK(grid.sliceExp() == 3);
    CHECK(grid.slotCount() == 1);
    CHECK(near(grid.remainderSec(), 2.0));

    grid.setSlice(4); // 16 beats does not fit a 12-beat loop
    CHECK(grid.sliceExp() == 3);
}

void testPlayheadIsNotStored() {
    bt::SliceGrid grid;
    const double playhead = 1.0; // one beat, held by the caller
    CHECK(near(grid.beatSec() * playhead, 0.5));
    grid.setBpm(60.0);
    CHECK(near(grid.beatSec() * playhead, 1.0));
    const bt::PlayheadPosition position = grid.positionAt(playhead);
    CHECK(position.slot == 1);
    CHECK(near(position.localBeats, 0.0));
}

void testTrackRead() {
    const bt::SliceGrid grid;
    CHECK(grid.trackSlices(1.2) == 3);
    CHECK(grid.trackSlices(1.3) == 3);
    CHECK(grid.trackSlices(0.1) == 1);
    CHECK(grid.trackSlices(0.75) == 2);
    CHECK(grid.trackSlices(grid.sliceSec() * 2.005) == 2);
    CHECK(grid.trackSlices(grid.sliceSec() * 2.02) == 3);

    // Slot 5, a quarter beat in. A 1 second track is two slices, so it wraps.
    CHECK(near(grid.trackRead(5.25, 5, 1.0), 0.625));
    CHECK(near(grid.trackRead(5.25, 5, 100.0), 2.625));
    CHECK(grid.trackRead(0.8, 0, 0.2) > 0.2);
}

void testSequenceAppendAndCrop() {
    bt::Rng rng(7);
    bt::Sequence sequence;
    sequence.generate(8, 2, rng);

    bt::Rng shadow(7);
    int prefix[8];
    for (int i = 0; i < 8; ++i) {
        prefix[i] = shadow.nextInt(2);
        CHECK(sequence.indexAt(i, 2) == prefix[i]);
    }
    CHECK(sequence.savedCount() == 2);
    // Rolls follow the indices, so the next index draw is after those floats.
    for (int i = 0; i < 8; ++i) {
        shadow.nextFloat();
    }

    const std::uint16_t* buffer = sequence.data();
    sequence.append(10, rng);
    CHECK(sequence.data() == buffer);
    CHECK(sequence.size() == 10);
    CHECK(sequence.savedCount() == 2);
    for (int i = 0; i < 8; ++i) {
        CHECK(sequence.indexAt(i, 2) == prefix[i]);
    }
    for (int i = 8; i < 10; ++i) {
        CHECK(sequence.indexAt(i, 2) == shadow.nextInt(2));
    }

    sequence.crop(5);
    CHECK(sequence.data() == buffer);
    CHECK(sequence.size() == 5);
    for (int i = 0; i < 5; ++i) {
        CHECK(sequence.indexAt(i, 2) == prefix[i]);
    }
    CHECK(buffer[5] == 0);

    sequence.clear();
    CHECK(sequence.empty());
    CHECK(sequence.savedCount() == 0);
}

void testIndexMapsOntoTheCurrentCount() {
    bt::Rng rng(4);
    bt::Sequence sequence;
    sequence.generate(4, 4, rng);
    bt::Rng shadow(4);
    for (int i = 0; i < 4; ++i) {
        const int stored = shadow.nextInt(4);
        CHECK(sequence.indexAt(i, 4) == stored);
        CHECK(sequence.indexAt(i, 3) == stored * 3 / 4);
        CHECK(sequence.indexAt(i, 5) == stored * 5 / 4);
    }
}

void testGenerateDrawsEveryTrack() {
    constexpr int kTracks = 8;
    constexpr int kSlots = bt::Sequence::kMaxSlots;
    for (std::uint64_t seed = 1; seed <= 4; ++seed) {
        bt::Rng rng(seed);
        bt::Sequence sequence;
        sequence.generate(kSlots, kTracks, rng);
        int seen[kTracks] = {};
        int highest = 0;
        for (int i = 0; i < kSlots; ++i) {
            const int index = sequence.indexAt(i, kTracks);
            CHECK(index >= 0);
            CHECK(index < kTracks);
            if (index >= 0 && index < kTracks) {
                ++seen[index];
            }
            if (index > highest) {
                highest = index;
            }
        }
        CHECK(highest > 2);
        for (int track = 0; track < kTracks; ++track) {
            CHECK(seen[track] > 0);
        }
    }
}

void testAssignReplacesThePrefix() {
    bt::Rng rng(1);
    bt::Sequence sequence;
    sequence.generate(4, 3, rng);
    const std::uint16_t slots[] = {2, 0, 1};
    sequence.assign(slots, 3, 3);
    CHECK(sequence.size() == 3);
    CHECK(sequence.savedCount() == 3);
    CHECK(sequence.indexAt(0, 3) == 2);
    CHECK(sequence.indexAt(1, 3) == 0);
    CHECK(sequence.indexAt(2, 3) == 1);
    sequence.assign(nullptr, 0, 0);
    CHECK(sequence.empty());
    CHECK(sequence.savedCount() == 0);
}

void testEffectIdsFollowTheWeights() {
    bt::Rng plainRng(5);
    bt::Sequence plain;
    plain.generate(6, 2, plainRng);
    bt::Rng delayRng(5);
    bt::Sequence delay;
    delay.generate(6, 2, delayRng, 0.0, 1.0);
    for (int i = 0; i < 6; ++i) {
        CHECK(delay.indexAt(i, 2) == plain.indexAt(i, 2));
        CHECK(delay.rollAt(i) == plain.rollAt(i));
        CHECK(plain.effectAt(i) == bt::EffectId::None);
        CHECK(delay.effectAt(i) == bt::EffectId::Delay);
    }

    bt::Rng reverbRng(9);
    bt::Sequence reverb;
    reverb.generate(4, 1, reverbRng, 1.0, 0.0);
    for (int i = 0; i < 4; ++i) {
        CHECK(reverb.effectAt(i) == bt::EffectId::Reverb);
    }

    bt::Rng reverseRng(9);
    bt::Sequence reversed;
    reversed.generate(4, 1, reverseRng, 0.0, 0.0, 1.0);
    for (int i = 0; i < 4; ++i) {
        CHECK(reversed.effectAt(i) == bt::EffectId::Reverse);
    }
    reversed.append(6, reverseRng, 0.0, 1.0, 0.0);
    CHECK(reversed.effectAt(0) == bt::EffectId::Reverse);

    bt::Rng filterRng(9);
    bt::Sequence filter;
    filter.generate(4, 1, filterRng, 0.0, 0.0, 0.0, 1.0);
    for (int i = 0; i < 4; ++i) {
        CHECK(filter.effectAt(i) == bt::EffectId::Filter);
    }

    bt::Rng flangerRng(9);
    bt::Sequence flanger;
    flanger.generate(4, 1, flangerRng, 0.0, 0.0, 0.0, 0.0, 1.0);
    for (int i = 0; i < 4; ++i) {
        CHECK(flanger.effectAt(i) == bt::EffectId::Flanger);
    }

    bt::Rng tranceRng(9);
    bt::Sequence trance;
    trance.generate(4, 1, tranceRng, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    for (int i = 0; i < 4; ++i) {
        CHECK(trance.effectAt(i) == bt::EffectId::Trance);
    }
    CHECK(reversed.effectAt(4) == bt::EffectId::Delay);
    CHECK(reversed.effectAt(5) == bt::EffectId::Delay);

    bt::Rng walkRng(2);
    bt::Sequence walked;
    walked.generate(1, 1, walkRng, 0.25, 0.75);
    bt::Rng walkShadow(2);
    walkShadow.nextInt(1);
    walkShadow.nextFloat();
    const float pick = walkShadow.nextFloat();
    const bt::EffectId expected = pick < 0.25f ? bt::EffectId::Reverb : bt::EffectId::Delay;
    CHECK(walked.effectAt(0) == expected);

    bt::Rng bothRng(1);
    bt::Sequence mixed;
    mixed.generate(80, 1, bothRng, 1.0, 1.0);
    int reverbs = 0;
    int delays = 0;
    for (int i = 0; i < mixed.size(); ++i) {
        if (mixed.effectAt(i) == bt::EffectId::Reverb) {
            ++reverbs;
        }
        if (mixed.effectAt(i) == bt::EffectId::Delay) {
            ++delays;
        }
    }
    CHECK(reverbs > 0);
    CHECK(delays > 0);

    const std::uint16_t slots[] = {1, 0};
    mixed.assign(slots, 2, 2);
    CHECK(mixed.effectAt(0) == bt::EffectId::None);
    CHECK(mixed.effectAt(1) == bt::EffectId::None);
    CHECK(mixed.rollAt(0) == 1.0f);
    CHECK(mixed.rollAt(1) == 1.0f);

    bt::Rng grownRng(4);
    bt::Sequence grown;
    grown.generate(2, 2, grownRng, 1.0, 0.0);
    grown.append(4, grownRng, 0.0, 1.0);
    CHECK(grown.effectAt(0) == bt::EffectId::Reverb);
    CHECK(grown.effectAt(1) == bt::EffectId::Reverb);
    CHECK(grown.effectAt(2) == bt::EffectId::Delay);
    CHECK(grown.effectAt(3) == bt::EffectId::Delay);
    grown.crop(2);
    CHECK(grown.effectAt(2) == bt::EffectId::None);
}

void testSameSeedSameSequence() {
    bt::Rng aRng(42);
    bt::Rng bRng(42);
    bt::Sequence a;
    bt::Sequence b;
    a.generate(8, 3, aRng);
    b.generate(8, 3, bRng);
    CHECK(a.size() == b.size());
    for (int i = 0; i < a.size(); ++i) {
        CHECK(a.indexAt(i, 3) == b.indexAt(i, 3));
    }
}

} // namespace

int main() {
    testGridDefaults();
    testGridDivisions();
    testSliceShrinksToTheLoop();
    testPlayheadIsNotStored();
    testTrackRead();
    testSequenceAppendAndCrop();
    testIndexMapsOntoTheCurrentCount();
    testGenerateDrawsEveryTrack();
    testAssignReplacesThePrefix();
    testEffectIdsFollowTheWeights();
    testSameSeedSameSequence();

    if (g_failed != 0) {
        std::printf("%d check(s) failed\n", g_failed);
        return 1;
    }
    std::printf("slice tests passed\n");
    return 0;
}
