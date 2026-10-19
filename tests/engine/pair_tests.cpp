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
    CHECK(bt::fadeLength(48000.0, 1.0) == 192);
    CHECK(bt::fadeLength(48000.0, 20.0 / 48000.0) == 10);
    CHECK(bt::fadeLength(48000.0, 2.0 / 48000.0) == 1);
    CHECK(bt::fadeLength(48000.0, 0.5 / 48000.0) == 0);
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
        const float gain = static_cast<float>(i) / 40.0f;
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
    CHECK(near(left[4980], 0.5));
    CHECK(near(right[4980], 0.5));
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

void testStopFallsFromTheCurrentGain() {
    constexpr int kRate = 10000;
    std::vector<float> samples(8000, 1.0f);
    bt::SliceEngine engine(kRate, 1);
    engine.append(bufferOf(1, samples));
    engine.play();

    std::vector<float> open(16);
    std::vector<float> openR(16);
    engine.render(open.data(), openR.data(), 16);

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
    constexpr int kFade = 40;
    constexpr int kRun = 1000;
    CHECK(bt::fadeLength(static_cast<double>(kRate), 0.5) == kFade);

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

} // namespace

int main() {
    testCurveRisesThenFalls();
    testFadeLength();
    testFileIsNotBlendedIntoItsHead();
    testLinearJoinIsTransparent();
    testSliceCutIsLinear();
    testRandomizeFadesTheOldPlayCurve();
    testStopFallsFromTheCurrentGain();
    testPlayAndStopReturnToTheStart();

    if (g_failed != 0) {
        std::printf("%d check(s) failed\n", g_failed);
        return 1;
    }
    std::printf("pair tests passed\n");
    return 0;
}
