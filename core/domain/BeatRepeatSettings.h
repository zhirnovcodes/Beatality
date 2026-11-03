#pragma once

#include "RepeatSequence.h"

#include <cmath>

namespace bt {

// The beat repeat knobs, written together.
// enabled turns the effect on. Off, the frames pass through.
// sizeMin and sizeMax are exponents: 2^size beats, from 1/32 through 2. Each firing records a size
// picked between them by that position's size roll. sizeMin is never above sizeMax.
// length is an exponent too: 2^length beats of tail, from 1/16 through 2. The tail is the recording
// played again after it was recorded.
// chance is 0..1. A position fires when it is on and its roll is below this.
// positions split the loop into 8 equal parts. Position i starts at i/8 of the loop.
// mix is 0..1, dry to wet.
struct BeatRepeatSettings {
    static constexpr int kSizeMin = -5;
    static constexpr int kSizeMax = 1;
    static constexpr int kLengthMin = -4;
    static constexpr int kLengthMax = 1;
    static constexpr double kChanceMin = 0;
    static constexpr double kChanceMax = 1;
    static constexpr double kMixMin = 0;
    static constexpr double kMixMax = 1;

    bool enabled = false;
    int sizeMin = 0;
    int sizeMax = 0;
    int length = 0;
    double chance = 0;
    bool positions[RepeatSequence::kPositions]{};
    double mix = 1;

    // The roll is in [0, 1). Each exponent from sizeMin to sizeMax gets an equal share.
    double beats(float roll) const {
        const int span = sizeMax - sizeMin + 1;
        int step = static_cast<int>(roll * static_cast<float>(span));
        if (step >= span) {
            step = span - 1;
        }
        return std::ldexp(1.0, sizeMin + step);
    }
    double lengthBeats() const { return std::ldexp(1.0, length); }
};

} // namespace bt
