#include "RepeatSequence.h"

namespace bt {

void RepeatSequence::generate(Rng& rng) {
    for (int i = 0; i < kPositions; ++i) {
        rolls_[i] = rng.nextFloat();
    }
    for (int i = 0; i < kPositions; ++i) {
        sizeRolls_[i] = rng.nextFloat();
    }
}

void RepeatSequence::clear() {
    for (int i = 0; i < kPositions; ++i) {
        rolls_[i] = 1.0f;
        sizeRolls_[i] = 0.0f;
    }
}

} // namespace bt
