#pragma once

#include "Rng.h"

#include <cstdint>

namespace bt {

// One buffer of kMaxSlots indices, allocated with the object.
// generate, append, and crop change how much of that buffer is in use.
// A longer sequence is written into the unused tail. Nothing is allocated or freed.
class Sequence {
public:
    static constexpr int kMaxSlots = 2048; // 32 beats / (1/64)

    bool empty() const;
    int size() const;
    int savedCount() const;
    const std::uint16_t* data() const;

    void clear();
    void generate(int slotCount, int trackCount, Rng& rng);
    void append(int slotCount, Rng& rng); // grow to slotCount, drawing from the saved count
    void crop(int slotCount);             // keep the prefix, clear the dropped tail

    // The stored index at that slot, mapped onto trackCount.
    // Same count: the stored index. Otherwise floor(stored / savedCount * trackCount).
    int indexAt(int slot, int trackCount) const;

private:
    std::uint16_t slots_[kMaxSlots]{};
    int size_ = 0;
    int savedCount_ = 0;
};

} // namespace bt
