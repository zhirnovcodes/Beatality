#include "Curve.h"
#include "SliceEngine.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
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

    if (g_failed != 0) {
        std::printf("%d check(s) failed\n", g_failed);
        return 1;
    }
    std::printf("pair tests passed\n");
    return 0;
}
