#pragma once

#include "Rng.h"

namespace bt {

// Beat repeat rolls per loop position, beside the slice sequence.
// generate draws a chance roll and a size roll for each position, both in [0, 1).
// clear stores chance rolls of 1, which fail every chance.
class RepeatSequence {
public:
    static constexpr int kPositions = 8;

    void generate(Rng& rng);
    void clear();
    float rollAt(int position) const { return rolls_[position]; }
    float sizeRollAt(int position) const { return sizeRolls_[position]; }

private:
    float rolls_[kPositions]{1, 1, 1, 1, 1, 1, 1, 1};
    float sizeRolls_[kPositions]{};
};

} // namespace bt
