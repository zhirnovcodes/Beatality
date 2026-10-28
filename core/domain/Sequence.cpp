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

} // namespace

bool Sequence::empty() const { return size_ == 0; }

int Sequence::size() const { return size_; }

int Sequence::savedCount() const { return savedCount_; }

const std::uint16_t* Sequence::data() const { return slots_; }

void Sequence::clear() {
    clearFrom(slots_, 0, size_);
    clearRolls(rolls_, 0, size_);
    size_ = 0;
    savedCount_ = 0;
}

void Sequence::generate(int slotCount, int trackCount, Rng& rng) {
    const int previous = size_;
    for (int i = 0; i < slotCount; ++i) {
        slots_[i] = static_cast<std::uint16_t>(rng.nextInt(trackCount));
    }
    // Rolls follow the indices so a dry chance still picks the same slices.
    for (int i = 0; i < slotCount; ++i) {
        rolls_[i] = rng.nextFloat();
    }
    if (slotCount < previous) {
        clearFrom(slots_, slotCount, previous);
        clearRolls(rolls_, slotCount, previous);
    }
    size_ = slotCount;
    savedCount_ = trackCount;
}

void Sequence::append(int slotCount, Rng& rng) {
    const int from = size_;
    for (int i = from; i < slotCount; ++i) {
        slots_[i] = static_cast<std::uint16_t>(rng.nextInt(savedCount_));
    }
    for (int i = from; i < slotCount; ++i) {
        rolls_[i] = rng.nextFloat();
    }
    size_ = slotCount;
}

void Sequence::crop(int slotCount) {
    clearFrom(slots_, slotCount, size_);
    clearRolls(rolls_, slotCount, size_);
    size_ = slotCount;
}

void Sequence::assign(const std::uint16_t* slots, int size, int savedCount) {
    const int previous = size_;
    for (int i = 0; i < size; ++i) {
        slots_[i] = slots[i];
        rolls_[i] = 1.0f;
    }
    if (size < previous) {
        clearFrom(slots_, size, previous);
        clearRolls(rolls_, size, previous);
    }
    size_ = size;
    savedCount_ = savedCount;
}

float Sequence::rollAt(int slot) const { return rolls_[slot]; }

int Sequence::indexAt(int slot, int trackCount) const {
    const int stored = slots_[slot];
    if (trackCount == savedCount_) {
        return stored;
    }
    return static_cast<int>((static_cast<long long>(stored) * trackCount) / savedCount_);
}

} // namespace bt
