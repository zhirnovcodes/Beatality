#include "Chaos.h"

#include <cstdio>

namespace {

int g_failed = 0;

void check(bool ok, const char* text, int line) {
    if (!ok) {
        std::printf("FAIL %s:%d  %s\n", "chaos_tests.cpp", line, text);
        ++g_failed;
    }
}

#define CHECK(cond) check(static_cast<bool>(cond), #cond, __LINE__)

constexpr int kRolls = 2000;

bt::Controls allOn(double value) {
    bt::Controls controls;
    controls.chaos.value = value;
    for (bool& group : controls.chaos.groups) {
        group = true;
    }
    return controls;
}

void testValueBlendsTheRange() {
    const bt::ChaosRange range{0, 0.5, 0, 1};
    CHECK(bt::chaosValue(range, 0, 0.0f) == 0.0);
    CHECK(bt::chaosValue(range, 0, 0.999f) < 0.5);
    CHECK(bt::chaosValue(range, 1, 0.999f) > 0.99);
    // The example from the design: chaos 0.5 picks from 0 to 0.75.
    CHECK(bt::chaosValue(range, 0.5, 0.999f) < 0.75);
    CHECK(bt::chaosValue(range, 0.5, 0.999f) > 0.74);
}

void testStepsShareTheRoll() {
    const bt::ChaosRange range{4, 6, 2, 16};
    CHECK(bt::chaosStep(range, 0, 0.0f) == 4);
    CHECK(bt::chaosStep(range, 0, 0.5f) == 5);
    CHECK(bt::chaosStep(range, 0, 0.999f) == 6);
    CHECK(bt::chaosStep(range, 1, 0.0f) == 2);
    CHECK(bt::chaosStep(range, 1, 0.999f) == 16);
}

void testChaosZeroStaysInTheNarrowRanges() {
    bt::Rng rng(7);
    for (int i = 0; i < kRolls; ++i) {
        bt::Controls controls = allOn(0);
        bt::rollChaos(controls, rng);
        CHECK(controls.play.panMin == 0.0 && controls.play.panMax == 0.0);
        CHECK(controls.play.sliceExp >= -1 && controls.play.sliceExp <= 0);
        CHECK(controls.play.attackMs >= 4 && controls.play.attackMs <= 6);
        CHECK(controls.effects.globalPower >= 0 && controls.effects.globalPower < 0.5);
        CHECK(controls.effects.shiftChance >= 0 && controls.effects.shiftChance < 0.25);
        CHECK(controls.effects.beatMin >= -2 && controls.effects.beatMax <= 0);
        CHECK(controls.effects.beatMin <= controls.effects.beatMax);
        CHECK(controls.repeat.sizeMin >= -2 && controls.repeat.sizeMax <= -1);
        CHECK(controls.repeat.sizeMin <= controls.repeat.sizeMax);
        CHECK(controls.repeat.length >= -1 && controls.repeat.length <= 0);
        CHECK(controls.repeat.mix < 0.5 && controls.repeat.chance < 0.25);
        CHECK(controls.chaos.value < 0.5);
        CHECK(controls.chaos.beatSize >= -1 && controls.chaos.beatSize <= 0);
        CHECK(controls.chaos.loopSize >= 2 && controls.chaos.loopSize <= 4);
        CHECK(controls.chaos.sliceSize >= -1 && controls.chaos.sliceSize <= 0);
    }
}

void testChaosOneReachesTheWideEnds() {
    bt::Rng rng(11);
    bool lowSlice = false;
    bool highSlice = false;
    bool hardLeft = false;
    bool longLoop = false;
    for (int i = 0; i < kRolls; ++i) {
        bt::Controls controls = allOn(1);
        bt::rollChaos(controls, rng);
        CHECK(controls.play.panMin >= -1 && controls.play.panMin <= 0);
        CHECK(controls.play.panMax >= 0 && controls.play.panMax <= 1);
        CHECK(controls.play.attackMs >= 2 && controls.play.attackMs <= 16);
        CHECK(controls.repeat.sizeMin >= bt::BeatRepeatSettings::kSizeMin && controls.repeat.sizeMax <= bt::BeatRepeatSettings::kSizeMax);
        lowSlice = lowSlice || controls.play.sliceExp == -4;
        highSlice = highSlice || controls.play.sliceExp == 4;
        hardLeft = hardLeft || controls.play.panMin < -0.99;
        longLoop = longLoop || controls.chaos.loopSize == 8;
    }
    CHECK(lowSlice && highSlice && hardLeft && longLoop);
}

void testGroupsThatAreOffKeepTheirKnobs() {
    bt::Rng rng(3);
    bt::Controls controls;
    controls.chaos.value = 1;
    controls.chaos.groups[static_cast<int>(bt::ChaosGroup::Attack)] = true;
    const bt::Controls before = controls;
    for (int i = 0; i < 100; ++i) {
        bt::rollChaos(controls, rng);
    }
    CHECK(controls.play.panMin == before.play.panMin && controls.play.sliceExp == before.play.sliceExp);
    CHECK(controls.effects == before.effects);
    CHECK(controls.repeat == before.repeat);
    CHECK(controls.chaos == before.chaos);
}

void testRandomizeAndTogglesAreAnEvenChance() {
    bt::Rng rng(5);
    int randomized = 0;
    int enabled = 0;
    for (int i = 0; i < kRolls; ++i) {
        bt::Controls controls = allOn(0);
        randomized += bt::rollChaos(controls, rng).randomize ? 1 : 0;
        enabled += controls.repeat.enabled ? 1 : 0;
    }
    CHECK(randomized > kRolls * 4 / 10 && randomized < kRolls * 6 / 10);
    CHECK(enabled > kRolls * 4 / 10 && enabled < kRolls * 6 / 10);
}

void testSameSeedSameRoll() {
    bt::Rng first(42);
    bt::Rng second(42);
    bt::Controls a = allOn(0.7);
    bt::Controls b = allOn(0.7);
    bt::rollChaos(a, first);
    bt::rollChaos(b, second);
    CHECK(a == b);
}

void testRollUsesTheValueFromBeforeIt() {
    bt::Rng rng(9);
    for (int i = 0; i < kRolls; ++i) {
        bt::Controls controls = allOn(0);
        bt::rollChaos(controls, rng);
        // Value 0 keeps attack in 4..6 even when the roll raised the value itself.
        CHECK(controls.play.attackMs >= 4 && controls.play.attackMs <= 6);
    }
}

} // namespace

int main() {
    testValueBlendsTheRange();
    testStepsShareTheRoll();
    testChaosZeroStaysInTheNarrowRanges();
    testChaosOneReachesTheWideEnds();
    testGroupsThatAreOffKeepTheirKnobs();
    testRandomizeAndTogglesAreAnEvenChance();
    testSameSeedSameRoll();
    testRollUsesTheValueFromBeforeIt();

    if (g_failed != 0) {
        std::printf("%d check(s) failed\n", g_failed);
        return 1;
    }
    std::printf("chaos tests passed\n");
    return 0;
}
