#include "Sequence.h"

namespace bt {

namespace {

void clearFrom(std::uint16_t* slots, int first, int last) {
    for (int i = first; i < last; ++i) {
        slots[i] = 0;
    }
}

void clearRolls(float* rolls, int first, int last) {
    for (int i = first; i < last; ++i) {
        rolls[i] = 0.0f;
    }
}

void clearEffects(EffectId* effects, int first, int last) {
    for (int i = first; i < last; ++i) {
        effects[i] = EffectId::None;
    }
}

// Walk reverb, then delay, then reverse, then filter, then flanger, then trance, then shift. The pick is compared with the running total over the sum.
EffectId pickEffect(Rng& rng, const Effects& settings) {
    const double sum = settings.reverbChance + settings.delayChance + settings.reverseChance + settings.filterChance + settings.flangerChance + settings.tranceChance + settings.shiftChance;
    if (sum == 0.0) {
        return EffectId::None;
    }
    const float pick = rng.nextFloat();
    const double weights[] = {settings.reverbChance, settings.delayChance, settings.reverseChance, settings.filterChance, settings.flangerChance, settings.tranceChance, settings.shiftChance};
    const EffectId ids[] = {EffectId::Reverb, EffectId::Delay, EffectId::Reverse, EffectId::Filter, EffectId::Flanger, EffectId::Trance, EffectId::Shift};
    double current = 0.0;
    for (int i = 0; i < 7; ++i) {
        current += weights[i];
        if (pick < current / sum) {
            return ids[i];
        }
    }
    return EffectId::None;
}

} // namespace

bool Sequence::empty() const { return size_ == 0; }

int Sequence::size() const { return size_; }

int Sequence::savedCount() const { return savedCount_; }

const std::uint16_t* Sequence::data() const { return slots_; }

void Sequence::clear() {
    clearFrom(slots_, 0, size_);
    clearRolls(rolls_, 0, size_);
    clearEffects(effects_, 0, size_);
    clearRolls(panRolls_, 0, size_);
    clearRolls(beatRolls_, 0, size_);
    size_ = 0;
    savedCount_ = 0;
}

void Sequence::generate(int slotCount, int trackCount, Rng& rng, const Effects& settings) {
    const int previous = size_;
    for (int i = 0; i < slotCount; ++i) {
        slots_[i] = static_cast<std::uint16_t>(rng.nextInt(trackCount));
    }
    // Rolls and effect ids follow the indices, so the slice picks stay put.
    for (int i = 0; i < slotCount; ++i) {
        rolls_[i] = rng.nextFloat();
    }
    for (int i = 0; i < slotCount; ++i) {
        effects_[i] = pickEffect(rng, settings);
    }
    for (int i = 0; i < slotCount; ++i) {
        panRolls_[i] = rng.nextFloat() * 2.0f - 1.0f;
    }
    for (int i = 0; i < slotCount; ++i) {
        beatRolls_[i] = rng.nextFloat();
    }
    if (slotCount < previous) {
        clearFrom(slots_, slotCount, previous);
        clearRolls(rolls_, slotCount, previous);
        clearEffects(effects_, slotCount, previous);
        clearRolls(panRolls_, slotCount, previous);
        clearRolls(beatRolls_, slotCount, previous);
    }
    size_ = slotCount;
    savedCount_ = trackCount;
}

void Sequence::append(int slotCount, Rng& rng, const Effects& settings) {
    const int from = size_;
    for (int i = from; i < slotCount; ++i) {
        slots_[i] = static_cast<std::uint16_t>(rng.nextInt(savedCount_));
    }
    for (int i = from; i < slotCount; ++i) {
        rolls_[i] = rng.nextFloat();
    }
    for (int i = from; i < slotCount; ++i) {
        effects_[i] = pickEffect(rng, settings);
    }
    for (int i = from; i < slotCount; ++i) {
        panRolls_[i] = rng.nextFloat() * 2.0f - 1.0f;
    }
    for (int i = from; i < slotCount; ++i) {
        beatRolls_[i] = rng.nextFloat();
    }
    size_ = slotCount;
}

void Sequence::regenerateEffects(Rng& rng, const Effects& settings) {
    for (int i = 0; i < size_; ++i) {
        effects_[i] = pickEffect(rng, settings);
    }
}

void Sequence::crop(int slotCount) {
    clearFrom(slots_, slotCount, size_);
    clearRolls(rolls_, slotCount, size_);
    clearEffects(effects_, slotCount, size_);
    clearRolls(panRolls_, slotCount, size_);
    clearRolls(beatRolls_, slotCount, size_);
    size_ = slotCount;
}

void Sequence::assign(const std::uint16_t* slots, int size, int savedCount) {
    const int previous = size_;
    for (int i = 0; i < size; ++i) {
        slots_[i] = slots[i];
        rolls_[i] = 1.0f;
        effects_[i] = EffectId::None;
        panRolls_[i] = 0.0f;
        beatRolls_[i] = 0.0f;
    }
    if (size < previous) {
        clearFrom(slots_, size, previous);
        clearRolls(rolls_, size, previous);
        clearEffects(effects_, size, previous);
        clearRolls(panRolls_, size, previous);
        clearRolls(beatRolls_, size, previous);
    }
    size_ = size;
    savedCount_ = savedCount;
}

float Sequence::rollAt(int slot) const { return rolls_[slot]; }

EffectId Sequence::effectAt(int slot) const { return effects_[slot]; }

float Sequence::panRollAt(int slot) const { return panRolls_[slot]; }

float Sequence::beatRollAt(int slot) const { return beatRolls_[slot]; }

int Sequence::indexAt(int slot, int trackCount) const {
    const int stored = slots_[slot];
    if (trackCount == savedCount_) {
        return stored;
    }
    return static_cast<int>((static_cast<long long>(stored) * trackCount) / savedCount_);
}

} // namespace bt
