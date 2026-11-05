#include "Chaos.h"

#include <algorithm>
#include <cmath>
#include <utility>

namespace bt {

namespace {

// Ranges at chaos 0 and at chaos 1. Exponents are 2^n beats; Slices is 2^n slices.
constexpr ChaosRange kPanMin{0, 0, -1, 0};
constexpr ChaosRange kPanMax{0, 0, 0, 1};
constexpr ChaosRange kSlice{-1, 0, SliceGrid::kExpMin, SliceGrid::kExpMax};
constexpr ChaosRange kAttack{4, 6, 2, 16};
constexpr ChaosRange kPower{0, 0.5, 0, 1};
constexpr ChaosRange kChance{0, 0.25, 0, 1};
constexpr ChaosRange kEffectTime{-2, 0, Effects::kBeatMin, Effects::kBeatMax};
constexpr ChaosRange kRepeatSize{-2, -1, BeatRepeatSettings::kSizeMin, BeatRepeatSettings::kSizeMax};
constexpr ChaosRange kRepeatMix{0, 0.5, 0, 1};
constexpr ChaosRange kRepeatLength{-1, 0, BeatRepeatSettings::kLengthMin, BeatRepeatSettings::kLengthMax};
constexpr ChaosRange kRepeatChance{0, 0.25, 0, 1};
constexpr ChaosRange kChaosValue{0, 0.5, 0, 1};
constexpr ChaosRange kBeatSize{-1, 0, ChaosSettings::kBeatSizeMin, ChaosSettings::kBeatSizeMax};
constexpr ChaosRange kLoopSize{2, 4, ChaosSettings::kLoopSizeMin, ChaosSettings::kLoopSizeMax};
constexpr ChaosRange kSliceSize{-1, 0, ChaosSettings::kSliceSizeMin, ChaosSettings::kSliceSizeMax};

double blend(double at0, double at1, double value) { return at0 + (at1 - at0) * value; }

bool coin(Rng& rng) { return rng.nextFloat() < 0.5f; }

// Two steps from the same range, low one first.
std::pair<int, int> stepPair(const ChaosRange& range, double value, Rng& rng) {
    const int a = chaosStep(range, value, rng.nextFloat());
    const int b = chaosStep(range, value, rng.nextFloat());
    return {std::min(a, b), std::max(a, b)};
}

} // namespace

double chaosValue(const ChaosRange& range, double value, float roll) {
    const double low = blend(range.low0, range.low1, value);
    const double high = blend(range.high0, range.high1, value);
    return low + (high - low) * static_cast<double>(roll);
}

int chaosStep(const ChaosRange& range, double value, float roll) {
    const int low = static_cast<int>(std::lround(blend(range.low0, range.low1, value)));
    const int high = static_cast<int>(std::lround(blend(range.high0, range.high1, value)));
    const int span = high - low + 1;
    const int step = std::min(static_cast<int>(roll * static_cast<float>(span)), span - 1);
    return low + step;
}

ChaosRoll rollChaos(Controls& controls, Rng& rng) {
    ChaosSettings& chaos = controls.chaos;
    const double value = chaos.value;
    ChaosRoll roll;
    if (chaos.on(ChaosGroup::Pan)) {
        controls.play.panMin = chaosValue(kPanMin, value, rng.nextFloat());
        controls.play.panMax = chaosValue(kPanMax, value, rng.nextFloat());
    }
    if (chaos.on(ChaosGroup::Slices)) {
        controls.play.sliceExp = chaosStep(kSlice, value, rng.nextFloat());
    }
    if (chaos.on(ChaosGroup::Attack)) {
        controls.play.attackMs = chaosStep(kAttack, value, rng.nextFloat());
    }
    if (chaos.on(ChaosGroup::Randomize)) {
        roll.randomize = coin(rng);
    }
    if (chaos.on(ChaosGroup::Effects)) {
        Effects& fx = controls.effects;
        fx.globalPower = chaosValue(kPower, value, rng.nextFloat());
        fx.globalChance = chaosValue(kChance, value, rng.nextFloat());
        const auto [beatMin, beatMax] = stepPair(kEffectTime, value, rng);
        fx.beatMin = beatMin;
        fx.beatMax = beatMax;
        double* const powers[] = {&fx.delayPower, &fx.reverbPower, &fx.reversePower, &fx.filterPower,
                                  &fx.flangerPower, &fx.trancePower, &fx.shiftPower};
        double* const chances[] = {&fx.delayChance, &fx.reverbChance, &fx.reverseChance, &fx.filterChance,
                                   &fx.flangerChance, &fx.tranceChance, &fx.shiftChance};
        for (int i = 0; i < 7; ++i) {
            *powers[i] = chaosValue(kPower, value, rng.nextFloat());
            *chances[i] = chaosValue(kChance, value, rng.nextFloat());
        }
    }
    if (chaos.on(ChaosGroup::BeatRepeat)) {
        BeatRepeatSettings& repeat = controls.repeat;
        repeat.enabled = coin(rng);
        for (bool& position : repeat.positions) {
            position = coin(rng);
        }
        const auto [sizeMin, sizeMax] = stepPair(kRepeatSize, value, rng);
        repeat.sizeMin = sizeMin;
        repeat.sizeMax = sizeMax;
        repeat.mix = chaosValue(kRepeatMix, value, rng.nextFloat());
        repeat.length = chaosStep(kRepeatLength, value, rng.nextFloat());
        repeat.chance = chaosValue(kRepeatChance, value, rng.nextFloat());
    }
    if (chaos.on(ChaosGroup::Value)) {
        chaos.value = chaosValue(kChaosValue, value, rng.nextFloat());
    }
    if (chaos.on(ChaosGroup::Time)) {
        chaos.beatSize = chaosStep(kBeatSize, value, rng.nextFloat());
        chaos.loopSize = chaosStep(kLoopSize, value, rng.nextFloat());
        chaos.sliceSize = chaosStep(kSliceSize, value, rng.nextFloat());
    }
    return roll;
}

Chaos::Chaos(std::uint64_t seed) : rng_(seed) {}

bool Chaos::tick(const ChaosSettings& settings, const SliceGrid& grid, double sampleRate, bool playing, std::int64_t frame) {
    const ChaosTrigger trigger = settings.trigger;
    if (!playing || trigger == ChaosTrigger::Button || trigger == ChaosTrigger::Note) {
        return false;
    }
    double beats = std::ldexp(1.0, settings.beatSize);
    if (trigger == ChaosTrigger::Slices) {
        beats = grid.sliceBeats() * std::ldexp(1.0, settings.sliceSize);
    } else if (trigger == ChaosTrigger::Loop) {
        beats = static_cast<double>(grid.loopBeats() * settings.loopSize);
    }
    const std::int64_t unit = std::llround(sampleRate * 60.0 / grid.bpm() * beats);
    const std::int64_t index = frame / unit;
    // A new unit size, or a clock sent back to the start, counts again from here.
    if (unit != unit_ || index < index_) {
        unit_ = unit;
        index_ = index;
        return false;
    }
    if (index == index_) {
        return false;
    }
    index_ = index;
    return true;
}

bool Chaos::noteOn(const ChaosSettings& settings) const { return settings.trigger == ChaosTrigger::Note; }

ChaosRoll Chaos::roll(Controls& controls) { return rollChaos(controls, rng_); }

} // namespace bt
