// params.json against the core: every range and default matches the constant or struct default the engine uses.
#include "BeatRepeatSettings.h"
#include "ChaosSettings.h"
#include "Effects.h"
#include "ParamsJson.h"
#include "SliceGrid.h"

#include <cstdio>
#include <cstring>

namespace {

int g_failed = 0;

void check(bool ok, const char* text, int line) {
    if (!ok) {
        std::printf("FAIL %s:%d  %s\n", "params_tests.cpp", line, text);
        ++g_failed;
    }
}

#define CHECK(cond) check(static_cast<bool>(cond), #cond, __LINE__)

constexpr int kCount = static_cast<int>(sizeof(kParams) / sizeof(kParams[0]));

const ParamSpec* find(const char* id) {
    for (const ParamSpec& param : kParams) {
        if (std::strcmp(param.id, id) == 0) {
            return &param;
        }
    }
    std::printf("FAIL params_tests.cpp  missing id %s\n", id);
    ++g_failed;
    return nullptr;
}

bool is(const char* kind, const char* expected) {
    return std::strcmp(kind, expected) == 0;
}

// One parameter: its kind, range, and default.
void expect(const char* id, const char* kind, double min, double max, double def, int line) {
    const ParamSpec* param = find(id);
    if (param == nullptr) {
        return;
    }
    if (!is(param->kind, kind) || param->min != min || param->max != max || param->def != def) {
        std::printf("FAIL params_tests.cpp:%d  %s is %s %g..%g default %g, expected %s %g..%g default %g\n", line, id,
                    param->kind, param->min, param->max, param->def, kind, min, max, def);
        ++g_failed;
    }
}

#define EXPECT(id, kind, min, max, def) expect(id, kind, min, max, def, __LINE__)

void testEveryEntryIsWellFormed() {
    CHECK(kCount == 50);
    for (int i = 0; i < kCount; ++i) {
        const ParamSpec& param = kParams[i];
        CHECK(param.min < param.max);
        CHECK(param.def >= param.min && param.def <= param.max);
        CHECK(is(param.kind, "float") || is(param.kind, "int") || is(param.kind, "boolean") || is(param.kind, "trigger") ||
              is(param.kind, "choice"));
        for (int j = i + 1; j < kCount; ++j) {
            CHECK(std::strcmp(param.id, kParams[j].id) != 0);
        }
    }
}

void testLoopAndOutput() {
    EXPECT("loop", "int", bt::SliceGrid::kMinLoop, bt::SliceGrid::kMaxLoop, 8);
    EXPECT("slice", "int", bt::SliceGrid::kExpMin, bt::SliceGrid::kExpMax, 0);
    EXPECT("randomize", "trigger", 0, 1, 0);
    EXPECT("chaos", "trigger", 0, 1, 0);
    EXPECT("volume", "float", 0, 1.2, 1);
    EXPECT("panMin", "float", -1, 1, 0);
    EXPECT("panMax", "float", -1, 1, 0);
    EXPECT("retrig", "boolean", 0, 1, 1);
}

void testEffects() {
    const bt::Effects fx;
    constexpr double lo = bt::Effects::kPowerMin;
    constexpr double hi = bt::Effects::kPowerMax;
    EXPECT("effectsOn", "boolean", 0, 1, fx.enabled ? 1 : 0);
    EXPECT("shuffle", "trigger", 0, 1, 0);
    EXPECT("globalPower", "float", lo, hi, fx.globalPower);
    EXPECT("globalChance", "float", bt::Effects::kChanceMin, bt::Effects::kChanceMax, fx.globalChance);
    EXPECT("fxTimeMin", "int", bt::Effects::kBeatMin, bt::Effects::kBeatMax, fx.beatMin);
    EXPECT("fxTimeMax", "int", bt::Effects::kBeatMin, bt::Effects::kBeatMax, fx.beatMax);
    EXPECT("delayPower", "float", lo, hi, fx.delayPower);
    EXPECT("delayChance", "float", lo, hi, fx.delayChance);
    EXPECT("reverbPower", "float", lo, hi, fx.reverbPower);
    EXPECT("reverbChance", "float", lo, hi, fx.reverbChance);
    EXPECT("reversePower", "float", lo, hi, fx.reversePower);
    EXPECT("reverseChance", "float", lo, hi, fx.reverseChance);
    EXPECT("filterPower", "float", lo, hi, fx.filterPower);
    EXPECT("filterChance", "float", lo, hi, fx.filterChance);
    EXPECT("flangerPower", "float", lo, hi, fx.flangerPower);
    EXPECT("flangerChance", "float", lo, hi, fx.flangerChance);
    EXPECT("trancePower", "float", lo, hi, fx.trancePower);
    EXPECT("tranceChance", "float", lo, hi, fx.tranceChance);
    EXPECT("shiftPower", "float", lo, hi, fx.shiftPower);
    EXPECT("shiftChance", "float", lo, hi, fx.shiftChance);
}

void testBeatRepeat() {
    using Repeat = bt::BeatRepeatSettings;
    const Repeat repeat;
    EXPECT("repeatOn", "boolean", 0, 1, repeat.enabled ? 1 : 0);
    EXPECT("repeatSizeMin", "int", Repeat::kSizeMin, Repeat::kSizeMax, repeat.sizeMin);
    EXPECT("repeatSizeMax", "int", Repeat::kSizeMin, Repeat::kSizeMax, repeat.sizeMax);
    EXPECT("repeatMix", "float", Repeat::kMixMin, Repeat::kMixMax, repeat.mix);
    EXPECT("repeatLength", "int", Repeat::kLengthMin, Repeat::kLengthMax, repeat.length);
    EXPECT("repeatChance", "float", Repeat::kChanceMin, Repeat::kChanceMax, repeat.chance);
}

void testChaos() {
    using Chaos = bt::ChaosSettings;
    const Chaos chaos;
    EXPECT("chaosTrigger", "choice", 0, static_cast<int>(bt::ChaosTrigger::None), static_cast<int>(chaos.trigger));
    EXPECT("chaosValue", "float", 0, 1, chaos.value);
    EXPECT("chaosBeatSize", "int", Chaos::kBeatSizeMin, Chaos::kBeatSizeMax, chaos.beatSize);
    EXPECT("chaosLoopSize", "int", Chaos::kLoopSizeMin, Chaos::kLoopSizeMax, chaos.loopSize);
    EXPECT("chaosSliceSize", "int", Chaos::kSliceSizeMin, Chaos::kSliceSizeMax, chaos.sliceSize);

    // The group toggles, in bt::ChaosGroup order.
    const char* const groups[] = {"chaosPan",           "chaosSlices",          "chaosRandomize",    "chaosEffectsGlobal",
                                  "chaosEffectsOn",     "chaosEffectsPrivate",  "chaosRepeatOn",     "chaosRepeatPositions",
                                  "chaosRepeatParams",  "chaosValueOn",         "chaosTime"};
    CHECK(Chaos::kGroups == 11);
    CHECK(static_cast<int>(sizeof(groups) / sizeof(groups[0])) == Chaos::kGroups);
    for (int group = 0; group < Chaos::kGroups; ++group) {
        EXPECT(groups[group], "boolean", 0, 1, chaos.groups[group] ? 1 : 0);
    }
}

} // namespace

int main() {
    testEveryEntryIsWellFormed();
    testLoopAndOutput();
    testEffects();
    testBeatRepeat();
    testChaos();
    if (g_failed != 0) {
        std::printf("params_tests: %d failed\n", g_failed);
        return 1;
    }
    std::printf("params_tests: all passed\n");
    return 0;
}
