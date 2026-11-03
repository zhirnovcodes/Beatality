#pragma once

#include "Effect.h"

namespace bt {

// Mixes this slice with the reversed frames of its beat parts.
// The copy rises from dry over the attack, holds, then falls back to dry.
// power is the lerp: 0 leaves the dry frame, 1 plays that shaped copy.
class Reverse {
public:
    Frame apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                const EffectParams& params);
    void clean();
};

} // namespace bt
