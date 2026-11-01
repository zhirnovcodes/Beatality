#pragma once

#include "Effect.h"

namespace bt {

// Mixes this frame with the reversed frame of its beat part.
// The copy rises from dry over the attack, holds, then falls back to dry.
// power is the lerp: 0 leaves the dry frame, 1 plays that shaped copy.
class Reverse {
public:
    void apply(float* l, float* r, const Playhead& playhead, const EffectParams& params);
    void clean();
};

} // namespace bt
