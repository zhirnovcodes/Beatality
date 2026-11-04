#include "BeatRepeat.h"
#include "Curve.h"
#include "SliceEngine.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <utility>
#include <vector>

namespace {

int g_failed = 0;

void check(bool ok, const char* text, int line) {
    if (!ok) {
        std::printf("FAIL %s:%d  %s\n", "pair_tests.cpp", line, text);
        ++g_failed;
    }
}

#define CHECK(cond) check(static_cast<bool>(cond), #cond, __LINE__)

bool near(double a, double b) { return std::fabs(a - b) < 1e-4; }

bt::SampleBuffer bufferOf(std::uint32_t id, const std::vector<float>& samples) {
    return {id, samples.data(), samples.data(), static_cast<int>(samples.size())};
}

void testCurveRisesThenFalls() {
    bt::Curve curve;
    curve.setLength(100);
    CHECK(curve.y(0) == 0.0f);
    CHECK(near(curve.y(40), 0.4));
    CHECK(curve.y(100) == 1.0f);
    CHECK(curve.y(150) == 1.0f);

    curve.stop(40);
    CHECK(near(curve.y(40), 0.4));
    CHECK(near(curve.y(90), 0.2));
    CHECK(curve.y(140) == 0.0f);
}

void testFadeLength() {
    CHECK(bt::fadeLength(48000.0, 1.0, 0.002) == 96);
    CHECK(bt::fadeLength(48000.0, 1.0, 0.016) == 768);
    CHECK(bt::fadeLength(48000.0, 20.0 / 48000.0, 0.016) == 10);
    CHECK(bt::fadeLength(48000.0, 2.0 / 48000.0, 0.002) == 1);
    CHECK(bt::fadeLength(48000.0, 0.5 / 48000.0, 0.002) == 0);
}

void testFileIsNotBlendedIntoItsHead() {
    constexpr int kRate = 10000;
    const float file[6] = {0.25f, 0.25f, 0.10f, 0.20f, 0.75f, 0.75f};
    bt::SliceEngine engine(kRate, 1);
    engine.append({1, file, file, 6});
    engine.play();

    float left[60];
    float right[60];
    engine.render(left, right, 60);
    for (int i = 0; i < 6; ++i) {
        const float gain = static_cast<float>(i) / 20.0f;
        CHECK(near(left[i], file[i] * gain));
        CHECK(near(right[i], file[i] * gain));
    }
    for (int i = 6; i < 60; ++i) {
        CHECK(left[i] == 0.0f);
        CHECK(right[i] == 0.0f);
    }
}

void testLinearJoinIsTransparent() {
    constexpr int kRate = 10000;
    constexpr int kFrames = 19000;
    std::vector<float> samples(20000);
    for (int i = 0; i < static_cast<int>(samples.size()); ++i) {
        samples[i] = 0.001f * static_cast<float>(i + 1);
    }

    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));
    engine.setLoop(4);
    engine.play();

    std::vector<float> left(kFrames);
    std::vector<float> right(kFrames);
    engine.render(left.data(), right.data(), kFrames);

    for (int i = 100; i < kFrames; ++i) {
        if (std::fabs(left[i] - samples[i]) > 0.0005f || std::fabs(right[i] - samples[i]) > 0.0005f) {
            std::printf("FAIL linear sample %d got %f / %f expected %f\n", i, left[i], right[i],
                        samples[i]);
            ++g_failed;
            break;
        }
    }
}

std::uint64_t seedForZeroThenOne() {
    for (std::uint64_t seed = 1; seed < 1000000; ++seed) {
        bt::Rng rng(seed);
        if (rng.nextInt(2) == 0 && rng.nextInt(2) == 1) {
            return seed;
        }
    }
    return 0;
}

void testSliceCutIsLinear() {
    constexpr int kRate = 10000;
    const std::uint64_t seed = seedForZeroThenOne();
    CHECK(seed != 0);

    std::vector<float> trackA(8000, 0.8f);
    std::vector<float> trackB(8000, 0.2f);
    bt::SliceEngine engine(kRate, seed);
    engine.append(bufferOf(1, trackA));
    engine.append(bufferOf(2, trackB));
    engine.setLoop(2);
    engine.play();

    constexpr int kFrames = 5200;
    std::vector<float> left(kFrames);
    std::vector<float> right(kFrames);
    engine.render(left.data(), right.data(), kFrames);

    CHECK(near(left[4800], 0.8));
    CHECK(near(left[4990], 0.5));
    CHECK(near(right[4990], 0.5));
    CHECK(near(left[5100], 0.2));
}

void testRandomizeFadesTheOldPlayCurve() {
    constexpr int kRate = 10000;
    std::vector<float> samples(8000);
    for (int i = 0; i < static_cast<int>(samples.size()); ++i) {
        samples[i] = 0.001f * static_cast<float>(i + 1);
    }
    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));
    engine.play();

    std::vector<float> open(500);
    std::vector<float> openR(500);
    engine.render(open.data(), openR.data(), 500);
    engine.randomize();

    std::vector<float> next(100);
    std::vector<float> nextR(100);
    engine.render(next.data(), nextR.data(), 100);
    for (int i = 0; i < 100; ++i) {
        const float expected = samples[500 + i];
        if (std::fabs(next[i] - expected) > 0.0005f) {
            std::printf("FAIL randomize sample %d got %f expected %f\n", i, next[i], expected);
            ++g_failed;
            break;
        }
    }
}

void testRandomizeReachesPastTheFirstThreeTracks() {
    constexpr int kRate = 10000;
    constexpr int kTracks = 8;
    constexpr int kSlots = 32;
    constexpr int kSlice = 5000;
    std::vector<std::vector<float>> tracks(kTracks);
    bt::SliceEngine engine(kRate, 7);
    for (int track = 0; track < kTracks; ++track) {
        tracks[track].assign(8000, 0.1f * static_cast<float>(track + 1));
        engine.append(bufferOf(static_cast<std::uint32_t>(track + 1), tracks[track]));
        engine.setTrack(track, 0.0, 1.0, true);
    }
    engine.setLoop(kSlots);
    engine.randomize();
    engine.play();

    std::vector<float> left(static_cast<std::size_t>(kSlice) * kSlots);
    std::vector<float> right(left.size());
    engine.render(left.data(), right.data(), static_cast<int>(left.size()));

    bool aboveTwo = false;
    for (int slot = 0; slot < kSlots; ++slot) {
        const float sample = left[static_cast<std::size_t>(slot) * kSlice + kSlice / 2];
        int match = -1;
        for (int track = 0; track < kTracks; ++track) {
            if (near(sample, 0.1 * (track + 1))) {
                match = track;
            }
        }
        CHECK(match >= 0);
        if (match > 2) {
            aboveTwo = true;
        }
    }
    CHECK(aboveTwo);
}

void testAttackLengthensTheSliceFade() {
    constexpr int kRate = 10000;
    const std::uint64_t seed = seedForZeroThenOne();
    CHECK(seed != 0);

    std::vector<float> trackA(8000, 0.8f);
    std::vector<float> trackB(8000, 0.2f);
    bt::SliceEngine engine(kRate, seed);
    engine.append(bufferOf(1, trackA));
    engine.append(bufferOf(2, trackB));
    engine.setLoop(2);
    engine.setAttack(16);
    engine.play();

    constexpr int kFrames = 5200;
    std::vector<float> left(kFrames);
    std::vector<float> right(kFrames);
    engine.render(left.data(), right.data(), kFrames);

    CHECK(near(left[4800], 0.8));
    CHECK(near(left[4920], 0.5));
    CHECK(near(right[4920], 0.5));
    CHECK(near(left[5100], 0.2));
}

void testStopFallsFromTheCurrentGain() {
    constexpr int kRate = 10000;
    std::vector<float> samples(8000, 1.0f);
    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));
    engine.play();

    std::vector<float> open(8);
    std::vector<float> openR(8);
    engine.render(open.data(), openR.data(), 8);

    engine.stop();
    std::vector<float> tail(120);
    std::vector<float> tailR(120);
    engine.render(tail.data(), tailR.data(), 120);

    CHECK(near(tail[0], 0.4));
    CHECK(tail[0] < 0.9f);
    CHECK(tail[119] == 0.0f);
    bt::SliceSnapshot snapshot;
    engine.fillSnapshot(snapshot);
    CHECK(!snapshot.playing);
}

void testPlayAndStopReturnToTheStart() {
    constexpr int kRate = 10000;
    constexpr int kFade = 20;
    constexpr int kRun = 1000;
    CHECK(bt::fadeLength(static_cast<double>(kRate), 0.5, 0.002) == kFade);

    std::vector<float> samples(8000);
    for (int i = 0; i < static_cast<int>(samples.size()); ++i) {
        samples[i] = 0.001f * static_cast<float>(i + 1);
    }

    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));
    engine.play();
    std::vector<float> open(kRun);
    std::vector<float> openR(kRun);
    engine.render(open.data(), openR.data(), kRun);

    engine.stop();
    std::vector<float> tail(kFade + 20);
    std::vector<float> tailR(kFade + 20);
    engine.render(tail.data(), tailR.data(), kFade + 20);
    CHECK(near(tail[0], samples[kRun]));
    CHECK(tail[kFade] == 0.0f);

    engine.play();
    std::vector<float> again(kFade);
    std::vector<float> againR(kFade);
    engine.render(again.data(), againR.data(), kFade);
    CHECK(again[0] == 0.0f);
    CHECK(near(again[kFade / 2], samples[kFade / 2] * 0.5f));

    bt::SliceEngine restart(kRate, 1);
    restart.append(bufferOf(1, samples));
    restart.play();
    restart.render(open.data(), openR.data(), kRun);
    restart.play();
    std::vector<float> fromStart(kFade);
    std::vector<float> fromStartR(kFade);
    restart.render(fromStart.data(), fromStartR.data(), kFade);
    CHECK(near(fromStart[0], samples[kRun]));
    const int mid = kFade / 2;
    const float crossed = samples[mid] * 0.5f + samples[kRun + mid] * 0.5f;
    CHECK(near(fromStart[mid], crossed));
}

void testTrackWindowIsWhatPlays() {
    constexpr int kRate = 10000;
    constexpr int kSlice = 5000;
    std::vector<float> samples(kSlice * 3, 0.8f);
    for (int i = 0; i < kSlice; ++i) {
        samples[static_cast<std::size_t>(i)] = 0.2f;
    }
    for (int i = kSlice; i < kSlice * 2; ++i) {
        samples[static_cast<std::size_t>(i)] = 0.5f;
    }

    auto probe = [&](double start, double length, bool loop, int at) {
        bt::SliceEngine engine(kRate, 1);
        engine.append(bufferOf(1, samples));
        engine.setLoop(4);
        engine.setTrack(0, start, length, loop);
        engine.play();
        std::vector<float> left(at + 1);
        std::vector<float> right(at + 1);
        engine.render(left.data(), right.data(), at + 1);
        return left[static_cast<std::size_t>(at)];
    };

    CHECK(near(probe(0.0, 1.0, false, 200), 0.2));
    CHECK(near(probe(0.0, 1.0, false, 5200), 0.5));
    CHECK(near(probe(0.0, 1.0, false, 10200), 0.8));
    CHECK(probe(0.0, 1.0, false, 15200) == 0.0f);

    CHECK(near(probe(1.0 / 3.0, 1.0, false, 200), 0.5));
    CHECK(near(probe(1.0 / 3.0, 1.0, false, 5200), 0.8));
    CHECK(probe(1.0 / 3.0, 1.0, false, 10200) == 0.0f);

    CHECK(near(probe(1.0 / 3.0, 0.0, false, 200), 0.5));
    CHECK(probe(1.0 / 3.0, 0.0, false, 5200) == 0.0f);

    CHECK(near(probe(1.0 / 3.0, 0.0, true, 200), 0.5));
    CHECK(near(probe(1.0 / 3.0, 0.0, true, 5200), 0.5));
    CHECK(near(probe(1.0 / 3.0, 0.0, true, 15200), 0.5));

    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));
    engine.setLoop(4);
    engine.setTrack(0, 1.0 / 3.0, 0.0, true);
    engine.play();
    std::vector<float> lead(10200);
    std::vector<float> leadR(10200);
    engine.render(lead.data(), leadR.data(), 10200);
    engine.randomize();
    std::vector<float> after(200);
    std::vector<float> afterR(200);
    engine.render(after.data(), afterR.data(), 200);
    CHECK(near(after[199], 0.5));
}

void testIndexedTrackKeepsTheSliceGrid() {
    constexpr int kRate = 10000;
    constexpr int kSlice = 5000;
    std::vector<float> left(kSlice * 2, 0.2f);
    std::vector<float> right(kSlice * 2, 0.5f);
    for (int i = kSlice; i < kSlice * 2; ++i) {
        left[static_cast<std::size_t>(i)] = 0.4f;
        right[static_cast<std::size_t>(i)] = 0.8f;
    }
    const bt::SampleBuffer buffer{1, left.data(), right.data(), static_cast<int>(left.size())};

    auto probe = [&](double start, double length, bool loop, double volume, double pan, int at) {
        bt::SliceEngine engine(kRate, 1);
        engine.append(buffer);
        engine.setIndexedTrack(0, start, length, loop, volume, pan);
        engine.play();
        std::vector<float> outL(at + 1);
        std::vector<float> outR(at + 1);
        engine.render(outL.data(), outR.data(), at + 1);
        return std::pair<float, float>(outL[static_cast<std::size_t>(at)], outR[static_cast<std::size_t>(at)]);
    };

    const auto head = probe(0.0, 0.0, false, 1.0, 0.0, 200);
    CHECK(near(head.first, 0.2));
    CHECK(near(head.second, 0.5));

    // Start halfway through the file, which is the second slice. The remainder is one slice.
    const auto mid = probe(0.5, 1.0, false, 1.0, 0.0, 200);
    CHECK(near(mid.first, 0.4));
    CHECK(near(mid.second, 0.8));
    const auto after = probe(0.5, 1.0, false, 1.0, 0.0, 5200);
    CHECK(after.first == 0.0f);
    CHECK(after.second == 0.0f);

    const auto quiet = probe(0.0, 0.0, false, 0.5, 0.0, 200);
    CHECK(near(quiet.first, 0.1));
    CHECK(near(quiet.second, 0.25));

    const auto hardLeft = probe(0.0, 0.0, false, 1.0, -1.0, 200);
    CHECK(near(hardLeft.first, 0.2));
    CHECK(hardLeft.second == 0.0f);

    const auto hardRight = probe(0.0, 0.0, false, 1.0, 1.0, 200);
    CHECK(hardRight.first == 0.0f);
    CHECK(near(hardRight.second, 0.5));
}

void testOutputVolumeAndPan() {
    constexpr int kRate = 10000;
    std::vector<float> left(8000, 0.5f);
    std::vector<float> right(8000, 0.25f);

    auto probe = [&](double volume, double pan) {
        bt::SliceEngine engine(kRate, 1);
        engine.append({1, left.data(), right.data(), static_cast<int>(left.size())});
        engine.setIndexedTrack(0, 0.0, 1.0, false, 0.5, 0.0);
        engine.setOutput(volume, pan, pan);
        engine.play();
        std::vector<float> outL(201);
        std::vector<float> outR(201);
        engine.render(outL.data(), outR.data(), 201);
        return std::pair<float, float>(outL[200], outR[200]);
    };

    const auto boosted = probe(1.2, 0.0);
    CHECK(near(boosted.first, 0.5f * 0.5f * 1.2f));
    CHECK(near(boosted.second, 0.25f * 0.5f * 1.2f));

    const auto hardLeft = probe(1.0, -1.0);
    CHECK(near(hardLeft.first, 0.5f * 0.5f));
    CHECK(hardLeft.second == 0.0f);

    const auto hardRight = probe(1.0, 1.0);
    CHECK(hardRight.first == 0.0f);
    CHECK(near(hardRight.second, 0.25f * 0.5f));

    const auto clamped = probe(5.0, 4.0);
    CHECK(clamped.first == 0.0f);
    CHECK(near(clamped.second, 0.25f * 0.5f * 1.2f));

    bt::SliceEngine engine(kRate, 1);
    engine.append({1, left.data(), right.data(), static_cast<int>(left.size())});
    engine.play();
    std::vector<float> open(201);
    std::vector<float> openR(201);
    engine.render(open.data(), openR.data(), 201);
    engine.setOutput(0.0, 0.0, 0.0);
    std::vector<float> closed(40);
    std::vector<float> closedR(40);
    engine.render(closed.data(), closedR.data(), 40);
    CHECK(closed[20] == 0.0f);
    CHECK(closedR[20] == 0.0f);
    CHECK(near(open[200], 0.5f));
}

// Each slice pans by its own roll, scaled onto the output pan range.
void testSlicePanFollowsTheRange() {
    constexpr int kRate = 10000;
    std::vector<float> left(8000, 0.5f);
    std::vector<float> right(8000, 0.5f);

    bt::SliceEngine engine(kRate, 3);
    engine.append({1, left.data(), right.data(), static_cast<int>(left.size())});
    engine.setOutput(1.0, -0.5, 0.25);
    engine.randomize();
    engine.play();
    std::vector<float> outL(201);
    std::vector<float> outR(201);
    engine.render(outL.data(), outR.data(), 201);

    bt::Sequence sequence;
    bt::Rng rng(3);
    bt::SliceGrid grid;
    sequence.generate(grid.slotCount(), 1, rng);
    const float roll = sequence.panRollAt(0);
    CHECK(roll >= -1.0f && roll < 1.0f);
    const double pan = -0.5 + (roll + 1.0) * 0.5 * 0.75;
    CHECK(near(outL[200], 0.5f * static_cast<float>(pan <= 0.0 ? 1.0 : 1.0 - pan)));
    CHECK(near(outR[200], 0.5f * static_cast<float>(pan >= 0.0 ? 1.0 : 1.0 + pan)));
}

void testPlayheadIsTheFractionOfTheLoop() {
    constexpr int kRate = 10000;
    std::vector<float> samples(8000, 0.5f);
    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));

    bt::SliceSnapshot snapshot;
    engine.fillSnapshot(snapshot);
    CHECK(snapshot.playhead == 0.0);

    engine.play();
    engine.fillSnapshot(snapshot);
    CHECK(snapshot.playing);
    CHECK(snapshot.playhead == 0.0);

    // 120 BPM and 8 beats is a 4 second loop: 40000 frames at this rate.
    std::vector<float> left(30000);
    std::vector<float> right(30000);
    engine.render(left.data(), right.data(), 10000);
    engine.fillSnapshot(snapshot);
    CHECK(near(snapshot.playhead, 0.25));

    engine.render(left.data(), right.data(), 30000);
    engine.fillSnapshot(snapshot);
    CHECK(snapshot.playhead == 0.0);

    engine.stop();
    engine.fillSnapshot(snapshot);
    CHECK(snapshot.playhead == 0.0);
}

void testSetTrackKeepsGain() {
    constexpr int kRate = 10000;
    std::vector<float> samples(8000, 0.5f);
    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));
    engine.setIndexedTrack(0, 0.0, 1.0, false, 0.5, 0.0);
    engine.setTrack(0, 0.0, 1.0, false);
    engine.play();
    std::vector<float> left(80);
    std::vector<float> right(80);
    engine.render(left.data(), right.data(), 80);
    CHECK(near(left[40], 0.25));
    CHECK(near(right[40], 0.25));
}

void testEmptyTrackIsSilent() {
    bt::SliceEngine engine(10000, 1);
    engine.append({1, nullptr, nullptr, 0});
    const std::uint16_t slot = 0;
    engine.installSequence(&slot, 1, 1);
    engine.play();
    float left[64];
    float right[64];
    engine.render(left, right, 64);
    for (int i = 0; i < 64; ++i) {
        CHECK(left[i] == 0.0f);
        CHECK(right[i] == 0.0f);
    }
    bt::SliceSnapshot snapshot;
    engine.fillSnapshot(snapshot);
    CHECK(snapshot.playing);
    CHECK(snapshot.playTrack == 0);
    CHECK(engine.sequenceSize() == 1);
    CHECK(engine.sequenceSavedCount() == 1);
    CHECK(engine.sequenceSlot(0) == 0);
}

void testClearWhileStoppedReleasesEveryTrack() {
    std::vector<float> first(8, 0.2f);
    std::vector<float> second(8, 0.4f);
    bt::SliceEngine engine(10000, 1);
    engine.append(bufferOf(1, first));
    engine.append(bufferOf(2, second));
    engine.clear();
    CHECK(engine.count() == 0);

    bt::SliceSnapshot snapshot;
    engine.fillSnapshot(snapshot);
    CHECK(snapshot.count == 0);
    CHECK(!snapshot.playing);
    CHECK(snapshot.releasedCount == 2);
    CHECK(snapshot.released[0] == 1);
    CHECK(snapshot.released[1] == 2);

    engine.fillSnapshot(snapshot);
    CHECK(snapshot.releasedCount == 0);
}

void testClearWhilePlayingFadesTheHeardTrack() {
    constexpr int kRate = 10000;
    std::vector<float> trackA(8000, 0.5f);
    std::vector<float> trackB(8000, 0.25f);
    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(11, trackA));
    engine.append(bufferOf(22, trackB));
    engine.play();

    std::vector<float> open(8);
    std::vector<float> openR(8);
    engine.render(open.data(), openR.data(), 8);

    bt::SliceSnapshot before;
    engine.fillSnapshot(before);
    CHECK(before.playing);
    CHECK(before.playTrack == 0 || before.playTrack == 1);
    const std::uint32_t kept = before.playTrack == 0 ? 11 : 22;
    const std::uint32_t dropped = before.playTrack == 0 ? 22 : 11;
    const float level = before.playTrack == 0 ? 0.5f : 0.25f;

    engine.stop();
    engine.clear();
    CHECK(engine.count() == 0);

    bt::SliceSnapshot cleared;
    engine.fillSnapshot(cleared);
    CHECK(!cleared.playing);
    CHECK(cleared.releasedCount == 1);
    CHECK(cleared.released[0] == dropped);

    std::vector<float> tail(40);
    std::vector<float> tailR(40);
    engine.render(tail.data(), tailR.data(), 40);
    CHECK(near(tail[0], level * 0.4f));
    CHECK(tail[39] == 0.0f);

    bt::SliceSnapshot done;
    engine.fillSnapshot(done);
    CHECK(done.releasedCount == 1);
    CHECK(done.released[0] == kept);

    std::vector<float> again(8000, 0.8f);
    engine.append(bufferOf(33, again));
    engine.play();
    std::vector<float> restarted(40);
    std::vector<float> restartedR(40);
    engine.render(restarted.data(), restartedR.data(), 40);
    CHECK(near(restarted[30], 0.8f));
}

void testReverseSplitsTheSlice() {
    // 120 BPM at 12 kHz is 6000 frames per beat. Half a beat makes two parts.
    constexpr int kRate = 12000;
    constexpr int kSlice = 6000;
    std::vector<float> samples(kSlice * 2);
    for (int i = 0; i < static_cast<int>(samples.size()); ++i) {
        samples[i] = 0.0001f * static_cast<float>(i + 1);
    }

    auto play = [&](double power, double chance, int beat) {
        bt::SliceEngine engine(kRate, 1);
        bt::Effects effects;
        effects.globalChance = chance;
        effects.reverseChance = 1;
        effects.reversePower = power;
        effects.beatMin = beat;
        effects.beatMax = beat;
        engine.setEffectsSettings(effects);
        engine.append(bufferOf(1, samples));
        engine.play();
        std::vector<float> left(kSlice);
        std::vector<float> right(kSlice);
        engine.render(left.data(), right.data(), kSlice);
        return left;
    };

    const std::vector<float> wet = play(1, 1, -1);
    CHECK(near(wet[100], samples[2899]));
    CHECK(near(wet[3100], samples[5899]));
    const int attack = bt::attackFrames(0.5, kRate);
    const int opening = attack / 2;
    const float open = static_cast<float>(opening) / static_cast<float>(attack);
    CHECK(near(wet[opening], samples[opening] + (samples[2999 - opening] - samples[opening]) * open));
    CHECK(near(wet[2999], samples[2999]));

    const std::vector<float> mixed = play(0.5, 1, -1);
    CHECK(near(mixed[100], 0.5f * (samples[100] + samples[2899])));

    const std::vector<float> dry = play(0, 1, -1);
    CHECK(near(dry[100], samples[100]));

    const std::vector<float> gated = play(1, 0, -1);
    CHECK(near(gated[100], samples[100]));

    const std::vector<float> whole = play(1, 1, 1);
    const int longAttack = bt::attackFrames(2.0, kRate);
    const float longOpen = 100.0f / static_cast<float>(longAttack);
    CHECK(near(whole[100], samples[100] + (samples[5899] - samples[100]) * longOpen));
}

double rmsOf(const std::vector<float>& samples, int from, int to) {
    double sum = 0.0;
    const int count = to - from;
    for (int i = from; i < to; ++i) {
        sum += static_cast<double>(samples[i]) * static_cast<double>(samples[i]);
    }
    return std::sqrt(sum / static_cast<double>(count));
}

void testFilterFollowsPowerAndBeat() {
    // 120 BPM at 48 kHz. The sweep starts at 1000 Hz, the middle of 100..10000.
    constexpr int kRate = 48000;
    constexpr int kFrames = 4000;
    constexpr double kPi = 3.14159265358979323846;

    auto tone = [&](double hz) {
        std::vector<float> samples(kFrames);
        for (int i = 0; i < kFrames; ++i) {
            samples[i] = static_cast<float>(std::sin(2.0 * kPi * hz * static_cast<double>(i) / static_cast<double>(kRate)));
        }
        return samples;
    };
    const std::vector<float> held(kFrames, 1.0f);
    const std::vector<float> high = tone(8000.0);
    const std::vector<float> low = tone(80.0);

    auto play = [&](const std::vector<float>& samples, double power, double chance, int beat) {
        bt::SliceEngine engine(kRate, 1);
        bt::Effects effects;
        effects.globalChance = chance;
        effects.filterChance = 1;
        effects.filterPower = power;
        effects.beatMin = beat;
        effects.beatMax = beat;
        engine.setEffectsSettings(effects);
        engine.append(bufferOf(1, samples));
        engine.play();
        std::vector<float> left(kFrames);
        std::vector<float> right(kFrames);
        engine.render(left.data(), right.data(), kFrames);
        CHECK(left[2500] == right[2500]);
        return left;
    };

    const std::vector<float> dry = play(held, 0, 1, 1);
    CHECK(dry[2500] == 1.0f);

    const std::vector<float> gated = play(held, 1, 0, 1);
    CHECK(gated[2500] == 1.0f);

    // Full power keeps a tenth of a constant. Velocity is 1, and the moving band leaves a small remainder.
    const std::vector<float> open = play(held, 1, 1, 1);
    CHECK(std::fabs(open[2500] - 0.1008) < 0.002);

    // Seed 1 starts the sine at 90 degrees, so two beats keep the band near 10000 here.
    const std::vector<float> slowHigh = play(high, 1, 1, 1);
    const std::vector<float> slowLow = play(low, 1, 1, 1);
    CHECK(rmsOf(slowHigh, 1200, 2000) > rmsOf(slowLow, 1200, 2000) * 4.0);

    // A sixteenth has already swept the band down to the bottom of its range here.
    const std::vector<float> fastHigh = play(high, 1, 1, -4);
    CHECK(rmsOf(slowHigh, 400, 1000) > rmsOf(fastHigh, 400, 1000) * 4.0);
}

void testFlangerFollowsPowerAndBeat() {
    // 120 BPM at 48 kHz. The sweep starts halfway between 0.5 ms and 8 ms, so the first echo is still silent here.
    constexpr int kRate = 48000;
    constexpr int kFrames = 4000;
    constexpr double kPi = 3.14159265358979323846;

    const std::vector<float> held(kFrames, 1.0f);
    std::vector<float> tone(kFrames);
    for (int i = 0; i < kFrames; ++i) {
        tone[i] = static_cast<float>(std::sin(2.0 * kPi * 1000.0 * static_cast<double>(i) / static_cast<double>(kRate)));
    }

    auto play = [&](const std::vector<float>& samples, double power, double chance, int beat) {
        bt::SliceEngine engine(kRate, 1);
        bt::Effects effects;
        effects.globalChance = chance;
        effects.flangerChance = 1;
        effects.flangerPower = power;
        effects.beatMin = beat;
        effects.beatMax = beat;
        engine.setEffectsSettings(effects);
        engine.append(bufferOf(1, samples));
        engine.play();
        std::vector<float> left(kFrames);
        std::vector<float> right(kFrames);
        engine.render(left.data(), right.data(), kFrames);
        CHECK(left[2500] == right[2500]);
        return left;
    };

    const std::vector<float> dry = play(held, 0, 1, 0);
    CHECK(dry[2500] == 1.0f);

    const std::vector<float> gated = play(held, 1, 0, 0);
    CHECK(gated[2500] == 1.0f);

    // Full power is an even mix. The delay line is still empty, so only the dry half is heard.
    const std::vector<float> open = play(held, 1, 1, 0);
    CHECK(open[150] == 0.5f);
    // Feedback has filled the line, so a constant sits above that dry half.
    CHECK(open[2500] > 1.5f);

    // Two beats barely move the delay. A sixteenth sweeps it across the tone.
    const std::vector<float> slow = play(tone, 1, 1, 1);
    const std::vector<float> fast = play(tone, 1, 1, -4);
    double diff = 0.0;
    for (int i = 1500; i < 3500; ++i) {
        diff += std::fabs(static_cast<double>(slow[i]) - static_cast<double>(fast[i]));
    }
    CHECK(diff > 50.0);
}

void testTranceFollowsPowerAndBeat() {
    // 120 BPM at 48 kHz. Seed 1 draws 11101010 first: three half-beats of sustain, then a gap.
    // A 1/16 beat is 1500 frames, so one step is 750. The attack is 4 ms, 192 frames.
    constexpr int kRate = 48000;
    constexpr int kFrames = 4000;

    const std::vector<float> held(kFrames, 1.0f);

    auto play = [&](double power, double chance, int beat) {
        bt::SliceEngine engine(kRate, 1);
        bt::Effects effects;
        effects.globalChance = chance;
        effects.tranceChance = 1;
        effects.trancePower = power;
        effects.beatMin = beat;
        effects.beatMax = beat;
        engine.setEffectsSettings(effects);
        engine.append(bufferOf(1, held));
        engine.play();
        std::vector<float> left(kFrames);
        std::vector<float> right(kFrames);
        engine.render(left.data(), right.data(), kFrames);
        CHECK(left[2000] == right[2000]);
        return left;
    };

    const std::vector<float> dry = play(0, 1, -4);
    CHECK(dry[2800] == 1.0f);

    const std::vector<float> gated = play(1, 0, -4);
    CHECK(gated[2800] == 1.0f);

    // The slice fade has finished. The gate is halfway up its attack, then holding, then shut.
    const std::vector<float> open = play(1, 1, -4);
    CHECK(near(open[96], 0.5));
    CHECK(open[2000] == 1.0f);
    CHECK(open[2400] == 1.0f);
    CHECK(open[2500] > 0.4f);
    CHECK(open[2500] < 0.9f);
    CHECK(open[2800] == 0.0f);

    // Half power leaves half of the dry signal in the gap and the whole sustain.
    const std::vector<float> mixed = play(0.5, 1, -4);
    CHECK(mixed[2000] == 1.0f);
    CHECK(mixed[2800] == 0.5f);

    // One beat is four times the step, so this same moment is still inside the sustain.
    const std::vector<float> wide = play(1, 1, 0);
    CHECK(wide[400] == 1.0f);
    CHECK(wide[2800] == 1.0f);
    CHECK(wide[96] < 0.4f);
}

double toneEnergy(const std::vector<float>& samples, int first, int count, double freq, double rate) {
    constexpr double kPi = 3.14159265358979323846;
    const double coeff = 2.0 * std::cos(2.0 * kPi * freq / rate);
    double s1 = 0.0;
    double s2 = 0.0;
    for (int i = 0; i < count; ++i) {
        const double s0 = static_cast<double>(samples[static_cast<std::size_t>(first + i)]) + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

void testShiftFollowsPowerAndBeat() {
    // 120 BPM at 48 kHz. One beat is 24000 frames. Seed 1 starts the sine at 270 degrees,
    // so it is -1 at frame 0 and +1 at frame 12000.
    // A 2000 Hz tone then sits at 1000 Hz, then at 3000 Hz. Power 1 is that full ±1000 Hz shift.
    constexpr int kRate = 48000;
    constexpr int kFrames = 20000;
    constexpr double kPi = 3.14159265358979323846;
    constexpr int kWindow = 192;

    std::vector<float> tone(kFrames);
    for (int i = 0; i < kFrames; ++i) {
        tone[static_cast<std::size_t>(i)] = static_cast<float>(std::sin(2.0 * kPi * 2000.0 * static_cast<double>(i) / static_cast<double>(kRate)));
    }

    auto play = [&](double power, double chance, int beat) {
        bt::SliceEngine engine(kRate, 1);
        bt::Effects effects;
        effects.globalChance = chance;
        effects.shiftChance = 1;
        effects.shiftPower = power;
        effects.beatMin = beat;
        effects.beatMax = beat;
        engine.setEffectsSettings(effects);
        engine.append(bufferOf(1, tone));
        engine.play();
        std::vector<float> left(kFrames);
        std::vector<float> right(kFrames);
        engine.render(left.data(), right.data(), kFrames);
        CHECK(left[6000] == right[6000]);
        return left;
    };

    const std::vector<float> dry = play(0, 1, 0);
    CHECK(dry[6000] == tone[6000]);

    const std::vector<float> gated = play(1, 0, 0);
    CHECK(gated[6000] == tone[6000]);

    const std::vector<float> open = play(1, 1, 0);
    const double up3k = toneEnergy(open, 11904, kWindow, 3000.0, kRate);
    const double up2k = toneEnergy(open, 11904, kWindow, 2000.0, kRate);
    const double up1k = toneEnergy(open, 11904, kWindow, 1000.0, kRate);
    const double up4k = toneEnergy(open, 11904, kWindow, 4000.0, kRate);
    if (!(up3k > 1000.0 && up3k > up2k * 8.0 && up3k > up1k * 8.0 && up3k > up4k * 8.0)) {
        std::printf("FAIL shift up 3000=%f 2000=%f 1000=%f 4000=%f\n", up3k, up2k, up1k, up4k);
        ++g_failed;
    }

    const double down1k = toneEnergy(open, 200, kWindow, 1000.0, kRate);
    const double down2k = toneEnergy(open, 200, kWindow, 2000.0, kRate);
    const double down3k = toneEnergy(open, 200, kWindow, 3000.0, kRate);
    const double down0 = toneEnergy(open, 200, kWindow, 500.0, kRate);
    if (!(down1k > 1000.0 && down1k > down2k * 8.0 && down1k > down3k * 8.0 && down1k > down0 * 8.0)) {
        std::printf("FAIL shift down 1000=%f 2000=%f 3000=%f 500=%f\n", down1k, down2k, down3k, down0);
        ++g_failed;
    }

    // A sixteenth sweeps the shift many times across the same stretch. One beat has barely left -1 here.
    const std::vector<float> fast = play(1, 1, -4);
    double diff = 0.0;
    for (int i = 2000; i < 4000; ++i) {
        diff += std::fabs(static_cast<double>(open[static_cast<std::size_t>(i)]) - static_cast<double>(fast[static_cast<std::size_t>(i)]));
    }
    CHECK(diff > 100.0);
}

// The input is its own frame index, so a repeated frame reads back where it was recorded.
std::vector<float> repeatRun(const bt::BeatRepeatSettings& repeat, const bt::RepeatSequence& rolls, int frames) {
    const bt::ClockSettings settings{10000, 120};
    const bt::SliceGrid grid;
    bt::Clock clock;
    bt::BeatRepeat effect(settings.sampleRate);
    std::vector<float> out(static_cast<std::size_t>(frames));
    for (int t = 0; t < frames; ++t) {
        const float in = static_cast<float>(t);
        out[static_cast<std::size_t>(t)] = effect.render({in, -in}, settings, clock, grid, repeat, rolls).l;
        clock.tick();
    }
    return out;
}

float largestStep(const std::vector<float>& out) {
    float step = 0.0f;
    for (std::size_t i = 1; i < out.size(); ++i) {
        step = std::fmax(step, std::fabs(out[i] - out[i - 1]));
    }
    return step;
}

void testBeatRepeatRecordsThenRepeats() {
    // 5000 frames a beat. Position 1 is beat 1 of the 8 beat loop.
    bt::Rng rng(3);
    bt::RepeatSequence rolls;
    rolls.generate(rng);
    bt::BeatRepeatSettings repeat;
    repeat.enabled = true;
    repeat.length = 1;
    repeat.chance = 1;
    repeat.positions[1] = true;
    const int fade = bt::attackFrames(1.0, 10000);

    // One beat recorded, then a 2 beat tail of it.
    const auto out = repeatRun(repeat, rolls, 45000);
    CHECK(out[4000] == 4000.0f);
    CHECK(out[7000] == 7000.0f);
    CHECK(out[10000 + fade + 10] == 5000.0f + fade + 10);
    CHECK(out[14999] == 9999.0f);
    CHECK(out[15000 + fade] == 5000.0f + fade);
    CHECK(out[19999] == 9999.0f);
    CHECK(out[20000 + fade] == 20000.0f + fade);
    // Every join crossfades. The widest is back to dry, 20000 against the 10000 frame continuation.
    CHECK(largestStep(out) < 10000.0f / fade + 2.0f);

    // A half beat tail cuts the first copy halfway.
    repeat.length = -1;
    const auto cut = repeatRun(repeat, rolls, 20000);
    CHECK(cut[11000] == 6000.0f);
    CHECK(cut[12500 + fade] == 12500.0f + fade);

    repeat.length = 1;
    repeat.mix = 0.5;
    const auto half = repeatRun(repeat, rolls, 20000);
    CHECK(near(half[16000], 0.5 * 16000 + 0.5 * 6000));

    repeat.mix = 1;
    repeat.enabled = false;
    const auto off = repeatRun(repeat, rolls, 20000);
    CHECK(off[16000] == 16000.0f);

    repeat.enabled = true;
    repeat.chance = 0;
    const auto missed = repeatRun(repeat, rolls, 20000);
    CHECK(missed[16000] == 16000.0f);

    repeat.chance = 1;
    rolls.clear();
    const auto cleared = repeatRun(repeat, rolls, 20000);
    CHECK(cleared[16000] == 16000.0f);
}

void testBeatRepeatSizeIsPickedFromTheRange() {
    bt::BeatRepeatSettings repeat;
    repeat.sizeMin = -4;
    repeat.sizeMax = 0;
    CHECK(repeat.beats(0.0f) == 1.0 / 16.0);
    CHECK(repeat.beats(0.5f) == 1.0 / 4.0);
    CHECK(repeat.beats(0.999f) == 1.0);

    bt::Rng rng(3);
    bt::RepeatSequence rolls;
    rolls.generate(rng);
    repeat.enabled = true;
    repeat.sizeMin = bt::BeatRepeatSettings::kSizeMin;
    repeat.sizeMax = bt::BeatRepeatSettings::kSizeMax;
    repeat.length = 1;
    repeat.chance = 1;
    repeat.positions[1] = true;
    const double beats = repeat.beats(rolls.sizeRollAt(1));
    const int size = static_cast<int>(std::llround(beats * 5000));
    int fade = bt::attackFrames(beats, 10000);
    if (fade > size / 2) {
        fade = size / 2;
    }

    // The first copy plays back what was recorded from beat 1.
    const auto out = repeatRun(repeat, rolls, 20000);
    CHECK(out[5000 + size + fade + 1] == 5000.0f + fade + 1);
}

void testBeatRepeatEndsAtTheLoopAndOnANewFiring() {
    bt::Rng rng(3);
    bt::RepeatSequence rolls;
    rolls.generate(rng);
    bt::BeatRepeatSettings repeat;
    repeat.enabled = true;
    repeat.length = 1;
    repeat.chance = 1;
    repeat.positions[1] = true;
    repeat.positions[2] = true;
    const int fade = bt::attackFrames(1.0, 10000);

    // Beat 2 fires and records again, so the beat 1 recording never plays.
    const auto out = repeatRun(repeat, rolls, 45000);
    CHECK(out[12000] == 12000.0f);
    CHECK(out[17000] == 12000.0f);
    CHECK(out[24999] == 14999.0f);
    CHECK(out[25000 + fade] == 25000.0f + fade);
    CHECK(largestStep(out) < 10000.0f / fade + 2.0f);

    // Position 7 records a half beat from beat 7. The loop end at 40000 cuts the 2 beat tail.
    repeat.sizeMin = -1;
    repeat.sizeMax = -1;
    repeat.positions[1] = false;
    repeat.positions[2] = false;
    repeat.positions[7] = true;
    const int halfFade = bt::attackFrames(0.5, 10000);
    const auto wrapped = repeatRun(repeat, rolls, 45000);
    CHECK(wrapped[36000] == 36000.0f);
    CHECK(wrapped[39000] == 36500.0f);
    CHECK(wrapped[40000 + halfFade] == 40000.0f + halfFade);
}

} // namespace

int main() {
    testCurveRisesThenFalls();
    testFadeLength();
    testFileIsNotBlendedIntoItsHead();
    testLinearJoinIsTransparent();
    testSliceCutIsLinear();
    testAttackLengthensTheSliceFade();
    testRandomizeReachesPastTheFirstThreeTracks();
    testRandomizeFadesTheOldPlayCurve();
    testStopFallsFromTheCurrentGain();
    testPlayAndStopReturnToTheStart();
    testTrackWindowIsWhatPlays();
    testIndexedTrackKeepsTheSliceGrid();
    testOutputVolumeAndPan();
    testSlicePanFollowsTheRange();
    testPlayheadIsTheFractionOfTheLoop();
    testSetTrackKeepsGain();
    testEmptyTrackIsSilent();
    testClearWhileStoppedReleasesEveryTrack();
    testClearWhilePlayingFadesTheHeardTrack();
    testReverseSplitsTheSlice();
    testFilterFollowsPowerAndBeat();
    testFlangerFollowsPowerAndBeat();
    testTranceFollowsPowerAndBeat();
    testShiftFollowsPowerAndBeat();
    testBeatRepeatRecordsThenRepeats();
    testBeatRepeatSizeIsPickedFromTheRange();
    testBeatRepeatEndsAtTheLoopAndOnANewFiring();

    if (g_failed != 0) {
        std::printf("%d check(s) failed\n", g_failed);
        return 1;
    }
    std::printf("pair tests passed\n");
    return 0;
}
