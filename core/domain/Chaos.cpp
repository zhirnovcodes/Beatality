#include "Chaos.h"

#include <algorithm>
#include <cmath>
#include <utility>

namespace bt {

namespace {

double blend(double at0, double at1, double value) { return at0 + (at1 - at0) * value; }

bool coin(Rng& rng) { return rng.nextFloat() < 0.5f; }

double rollValue(const ChaosRange& range, double value, Rng& rng, double low, double high) {
    return std::clamp(chaosValue(range, value, rng.nextFloat()), low, high);
}

int rollStep(const ChaosRange& range, double value, Rng& rng, int low, int high) {
    return std::clamp(chaosStep(range, value, rng.nextFloat()), low, high);
}

// A min and a max from their own ranges, low one first.
std::pair<int, int> rollPair(const ChaosRange& min, const ChaosRange& max, double value, Rng& rng, int low, int high) {
    const int a = rollStep(min, value, rng, low, high);
    const int b = rollStep(max, value, rng, low, high);
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
    namespace playRanges = chaosRanges::play;
    ChaosSettings& chaos = controls.chaos;
    const double value = chaos.value;
    ChaosRoll roll;
    if (chaos.on(ChaosGroup::Pan)) {
        controls.play.panMin = rollValue(playRanges::panMin, value, rng, -1, 1);
        controls.play.panMax = rollValue(playRanges::panMax, value, rng, -1, 1);
    }
    if (chaos.on(ChaosGroup::Slices)) {
        controls.play.sliceExp = rollStep(playRanges::slices, value, rng, SliceGrid::kExpMin, SliceGrid::kExpMax);
    }
    if (chaos.on(ChaosGroup::Randomize)) {
        roll.randomize = true;
    }
    Effects& fx = controls.effects;
    namespace fxRanges = chaosRanges::effects;
    if (chaos.on(ChaosGroup::EffectsGlobal)) {
        fx.globalPower = rollValue(fxRanges::power, value, rng, Effects::kPowerMin, Effects::kPowerMax);
        fx.globalChance = rollValue(fxRanges::chance, value, rng, Effects::kChanceMin, Effects::kChanceMax);
        const auto [beatMin, beatMax] =
            rollPair(fxRanges::timeMin, fxRanges::timeMax, value, rng, Effects::kBeatMin, Effects::kBeatMax);
        fx.beatMin = beatMin;
        fx.beatMax = beatMax;
    }
    if (chaos.on(ChaosGroup::EffectsOn)) {
        fx.enabled = coin(rng);
    }
    if (chaos.on(ChaosGroup::EffectsPrivate)) {
        double* const powers[] = {&fx.delayPower, &fx.reverbPower, &fx.reversePower, &fx.filterPower,
                                  &fx.flangerPower, &fx.trancePower, &fx.shiftPower};
        double* const chances[] = {&fx.delayChance, &fx.reverbChance, &fx.reverseChance, &fx.filterChance,
                                   &fx.flangerChance, &fx.tranceChance, &fx.shiftChance};
        for (int i = 0; i < 7; ++i) {
            *powers[i] = rollValue(fxRanges::effectPower, value, rng, Effects::kPowerMin, Effects::kPowerMax);
            const double chance = rollValue(fxRanges::effectChance, value, rng, Effects::kChanceMin, Effects::kChanceMax);
            roll.regenerateEffects = roll.regenerateEffects || chance != *chances[i];
            *chances[i] = chance;
        }
    }
    BeatRepeatSettings& repeat = controls.repeat;
    namespace repeatRanges = chaosRanges::beatRepeat;
    using Repeat = BeatRepeatSettings;
    if (chaos.on(ChaosGroup::RepeatOn)) {
        repeat.enabled = coin(rng);
    }
    if (chaos.on(ChaosGroup::RepeatPositions)) {
        for (bool& position : repeat.positions) {
            position = coin(rng);
        }
    }
    if (chaos.on(ChaosGroup::RepeatParams)) {
        const auto [sizeMin, sizeMax] =
            rollPair(repeatRanges::sizeMin, repeatRanges::sizeMax, value, rng, Repeat::kSizeMin, Repeat::kSizeMax);
        repeat.sizeMin = sizeMin;
        repeat.sizeMax = sizeMax;
        repeat.mix = rollValue(repeatRanges::mix, value, rng, Repeat::kMixMin, Repeat::kMixMax);
        repeat.length = rollStep(repeatRanges::length, value, rng, Repeat::kLengthMin, Repeat::kLengthMax);
        const double chance = rollValue(repeatRanges::chance, value, rng, Repeat::kChanceMin, Repeat::kChanceMax);
        roll.regenerateRepeat = chance != repeat.chance;
        repeat.chance = chance;
    }
    namespace timeRanges = chaosRanges::chaos;
    if (chaos.on(ChaosGroup::Value)) {
        chaos.value = rollValue(timeRanges::value, value, rng, 0, 1);
    }
    if (chaos.on(ChaosGroup::Time)) {
        chaos.beatSize = rollStep(timeRanges::beatSize, value, rng, ChaosSettings::kBeatSizeMin, ChaosSettings::kBeatSizeMax);
        chaos.loopSize = rollStep(timeRanges::loopSize, value, rng, ChaosSettings::kLoopSizeMin, ChaosSettings::kLoopSizeMax);
        chaos.sliceSize = rollStep(timeRanges::sliceSize, value, rng, ChaosSettings::kSliceSizeMin, ChaosSettings::kSliceSizeMax);
    }
    return roll;
}

Chaos::Chaos(std::uint64_t seed) : rng_(seed) {}

bool Chaos::tick(const ChaosSettings& settings, const SliceGrid& grid, double sampleRate, bool playing, std::int64_t frame) {
    const ChaosTrigger trigger = settings.trigger;
    if (!playing || (trigger != ChaosTrigger::Loop && trigger != ChaosTrigger::Slices && trigger != ChaosTrigger::Beats)) {
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

// unit_ 0 matches no unit, so the next tick takes the clock where it is.
void Chaos::restart() { unit_ = 0; }

bool Chaos::noteOn(const ChaosSettings& settings) const { return settings.trigger == ChaosTrigger::Note; }

ChaosRoll Chaos::roll(Controls& controls) { return rollChaos(controls, rng_); }

} // namespace bt
