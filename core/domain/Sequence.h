#pragma once

#include "Rng.h"

#include <cstdint>

namespace bt {

// Chosen once, beside the track index. None stays dry.
enum class EffectId : std::uint8_t {
    None = 0,
    Reverb = 1,
    Delay = 2,
    Reverse = 3,
};

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
    // reverbChance, delayChance, and reverseChance weight the effect id. A sum of 0 stores none.
    void generate(int slotCount, int trackCount, Rng& rng, double reverbChance = 0, double delayChance = 0, double reverseChance = 0);
    void append(int slotCount, Rng& rng, double reverbChance = 0, double delayChance = 0, double reverseChance = 0); // grow to slotCount
    void crop(int slotCount); // keep the prefix, clear the dropped tail
    // Replaces the live prefix. size 0 clears. The caller keeps slots for the copy.
    void assign(const std::uint16_t* slots, int size, int savedCount);

    // The stored index at that slot, mapped onto trackCount.
    // Same count: the stored index. Otherwise floor(stored / savedCount * trackCount).
    int indexAt(int slot, int trackCount) const;
    // Drawn in [0, 1) by generate and append. assign stores 1, which fails every chance.
    float rollAt(int slot) const;
    // Chosen when the slot is written. assign stores none, so a loaded pack stays dry.
    EffectId effectAt(int slot) const;

private:
    std::uint16_t slots_[kMaxSlots]{};
    float rolls_[kMaxSlots]{};
    EffectId effects_[kMaxSlots]{};
    int size_ = 0;
    int savedCount_ = 0;
};

} // namespace bt
