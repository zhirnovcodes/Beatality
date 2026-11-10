#include "Chaos.h"

#include <cstdio>
#include <initializer_list>

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
        CHECK(controls.play.sliceExp >= -1 && controls.play.sliceExp <= 4);
        CHECK(controls.effects.globalPower >= 0 && controls.effects.globalPower < 0.75);
        CHECK(controls.effects.shiftChance >= 0 && controls.effects.shiftChance < 0.35);
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
        CHECK(controls.repeat.sizeMin >= bt::BeatRepeatSettings::kSizeMin && controls.repeat.sizeMax <= bt::BeatRepeatSettings::kSizeMax);
        lowSlice = lowSlice || controls.play.sliceExp == -4;
        // Full chaos slices from -4 to 0 (ChaosRanges.h).
        CHECK(controls.play.sliceExp >= -4 && controls.play.sliceExp <= 0);
        highSlice = highSlice || controls.play.sliceExp == 0;
        hardLeft = hardLeft || controls.play.panMin < -0.99;
        longLoop = longLoop || controls.chaos.loopSize == 8;
    }
    CHECK(lowSlice && highSlice && hardLeft && longLoop);
}

void testGroupsThatAreOffKeepTheirKnobs() {
    bt::Rng rng(3);
    bt::Controls controls;
    controls.chaos.value = 1;
    controls.chaos.groups[static_cast<int>(bt::ChaosGroup::Pan)] = true;
    const bt::Controls before = controls;
    for (int i = 0; i < 100; ++i) {
        bt::rollChaos(controls, rng);
    }
    CHECK(controls.play.sliceExp == before.play.sliceExp && controls.play.attackMs == before.play.attackMs);
    CHECK(controls.effects == before.effects);
    CHECK(controls.repeat == before.repeat);
    CHECK(controls.chaos == before.chaos);
}

void testRandomizeAlwaysAndTogglesAreAnEvenChance() {
    bt::Rng rng(5);
    int randomized = 0;
    int enabled = 0;
    for (int i = 0; i < kRolls; ++i) {
        bt::Controls controls = allOn(0);
        randomized += bt::rollChaos(controls, rng).randomize ? 1 : 0;
        enabled += controls.repeat.enabled ? 1 : 0;
    }
    CHECK(randomized == kRolls);
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

void testRollAsksToRegenerateWhenChancesChange() {
    bt::Rng rng(13);
    bt::Controls controls = allOn(0.5);
    const bt::ChaosRoll roll = bt::rollChaos(controls, rng);
    CHECK(roll.regenerateEffects);
    CHECK(roll.regenerateRepeat);

    bt::Controls off;
    off.chaos.value = 1;
    off.chaos.groups[static_cast<int>(bt::ChaosGroup::Pan)] = true;
    const bt::ChaosRoll quiet = bt::rollChaos(off, rng);
    CHECK(!quiet.regenerateEffects);
    CHECK(!quiet.regenerateRepeat);
}

void testRollUsesTheValueFromBeforeIt() {
    bt::Rng rng(9);
    for (int i = 0; i < kRolls; ++i) {
        bt::Controls controls = allOn(0);
        bt::rollChaos(controls, rng);
        // Value 0 keeps the global power under 0.75 even when the roll raised the value itself.
        CHECK(controls.effects.globalPower < 0.75);
    }
}

// 120 BPM at 1000 frames a second: a beat is 500 frames.
void testTickRollsOnEachNewUnit() {
    bt::SliceGrid grid;
    bt::ChaosSettings settings;
    settings.trigger = bt::ChaosTrigger::Beats;
    settings.beatSize = 0;
    bt::Chaos chaos(1);
    int rolls = 0;
    int firstAt = -1;
    for (int frame = 0; frame < 2000; ++frame) {
        if (chaos.tick(settings, grid, 1000, true, frame)) {
            ++rolls;
            if (firstAt < 0) {
                firstAt = frame;
            }
        }
    }
    CHECK(firstAt == 500);
    CHECK(rolls == 3);
}

void testTickCountsLoopsAndSlices() {
    bt::SliceGrid grid; // 8 beats, slices of 1 beat
    bt::ChaosSettings settings;
    settings.trigger = bt::ChaosTrigger::Loop;
    settings.loopSize = 2;
    bt::Chaos loops(1);
    int loopRolls = 0;
    for (int frame = 0; frame < 16000; ++frame) {
        loopRolls += loops.tick(settings, grid, 1000, true, frame) ? 1 : 0;
    }
    CHECK(loopRolls == 1); // at frame 8000, two loops of 4000

    settings.trigger = bt::ChaosTrigger::Slices;
    settings.sliceSize = -1; // half a slice
    bt::Chaos slices(1);
    int sliceRolls = 0;
    for (int frame = 0; frame < 1000; ++frame) {
        sliceRolls += slices.tick(settings, grid, 1000, true, frame) ? 1 : 0;
    }
    CHECK(sliceRolls == 3); // at 250, 500, 750
}

void testTickIsQuietWhenStoppedOrNotCounting() {
    bt::SliceGrid grid;
    bt::ChaosSettings settings;
    settings.trigger = bt::ChaosTrigger::Beats;
    bt::Chaos stopped(1);
    bool rolled = false;
    for (int frame = 0; frame < 2000; ++frame) {
        rolled = rolled || stopped.tick(settings, grid, 1000, false, frame);
    }
    CHECK(!rolled);
    for (const bt::ChaosTrigger trigger : {bt::ChaosTrigger::Note, bt::ChaosTrigger::None}) {
        settings.trigger = trigger;
        bt::Chaos chaos(1);
        for (int frame = 0; frame < 2000; ++frame) {
            rolled = rolled || chaos.tick(settings, grid, 1000, true, frame);
        }
    }
    CHECK(!rolled);
}

void testTickStartsAgainWhenTheClockGoesBack() {
    bt::SliceGrid grid;
    bt::ChaosSettings settings;
    settings.trigger = bt::ChaosTrigger::Beats;
    bt::Chaos chaos(1);
    for (int frame = 0; frame < 700; ++frame) {
        chaos.tick(settings, grid, 1000, true, frame);
    }
    // A new note: the clock is back at 0. That is not a roll, and the next beat is.
    CHECK(!chaos.tick(settings, grid, 1000, true, 0));
    CHECK(!chaos.tick(settings, grid, 1000, true, 499));
    CHECK(chaos.tick(settings, grid, 1000, true, 500));
}

void testNoteRollsOnlyInNoteMode() {
    const bt::Chaos chaos(1);
    bt::ChaosSettings settings;
    settings.trigger = bt::ChaosTrigger::Note;
    CHECK(chaos.noteOn(settings));
    for (const bt::ChaosTrigger trigger : {bt::ChaosTrigger::Loop, bt::ChaosTrigger::Slices,
                                           bt::ChaosTrigger::Beats, bt::ChaosTrigger::None}) {
        settings.trigger = trigger;
        CHECK(!chaos.noteOn(settings));
    }
}

} // namespace

int main() {
    testValueBlendsTheRange();
    testStepsShareTheRoll();
    testChaosZeroStaysInTheNarrowRanges();
    testChaosOneReachesTheWideEnds();
    testGroupsThatAreOffKeepTheirKnobs();
    testRandomizeAlwaysAndTogglesAreAnEvenChance();
    testSameSeedSameRoll();
    testRollUsesTheValueFromBeforeIt();
    testRollAsksToRegenerateWhenChancesChange();
    testTickRollsOnEachNewUnit();
    testTickCountsLoopsAndSlices();
    testTickIsQuietWhenStoppedOrNotCounting();
    testTickStartsAgainWhenTheClockGoesBack();
    testNoteRollsOnlyInNoteMode();

    if (g_failed != 0) {
        std::printf("%d check(s) failed\n", g_failed);
        return 1;
    }
    std::printf("chaos tests passed\n");
    return 0;
}
