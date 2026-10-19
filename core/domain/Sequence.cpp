#include "Sequence.h"

namespace bt {

namespace {

void clearFrom(std::uint16_t* slots, int first, int last) {
    for (int i = first; i < last; ++i) {
        slots[i] = 0;
    }
}

} // namespace

bool Sequence::empty() const { return size_ == 0; }

int Sequence::size() const { return size_; }

int Sequence::savedCount() const { return savedCount_; }

const std::uint16_t* Sequence::data() const { return slots_; }

void Sequence::clear() {
    clearFrom(slots_, 0, size_);
    size_ = 0;
    savedCount_ = 0;
}

void Sequence::generate(int slotCount, int trackCount, Rng& rng) {
    const int previous = size_;
    for (int i = 0; i < slotCount; ++i) {
        slots_[i] = static_cast<std::uint16_t>(rng.nextInt(trackCount));
    }
    if (slotCount < previous) {
        clearFrom(slots_, slotCount, previous);
    }
    size_ = slotCount;
    savedCount_ = trackCount;
}

void Sequence::append(int slotCount, Rng& rng) {
    for (int i = size_; i < slotCount; ++i) {
        slots_[i] = static_cast<std::uint16_t>(rng.nextInt(savedCount_));
    }
    size_ = slotCount;
}

void Sequence::crop(int slotCount) {
    clearFrom(slots_, slotCount, size_);
    size_ = slotCount;
}

int Sequence::indexAt(int slot, int trackCount) const {
    const int stored = slots_[slot];
    if (trackCount == savedCount_) {
        return stored;
    }
    return static_cast<int>((static_cast<long long>(stored) * trackCount) / savedCount_);
}

} // namespace bt
