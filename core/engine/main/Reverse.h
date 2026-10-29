#pragma once

namespace bt {

// Mixes the dry frame with the reversed frame of its beat part.
// The reversed copy has already opened and closed over the attack. wet is the lerp:
// 0 leaves the dry frame, 1 plays that shaped copy.
class Reverse {
public:
    void apply(float dryL, float dryR, float revL, float revR, float wet, float& outL, float& outR);
    void clean();
};

} // namespace bt
