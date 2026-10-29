#include "Reverse.h"

namespace bt {

void Reverse::apply(float dryL, float dryR, float revL, float revR, float wet, float& outL, float& outR) {
    const float mix = wet < 0.0f ? 0.0f : (wet > 1.0f ? 1.0f : wet);
    outL = dryL + (revL - dryL) * mix;
    outR = dryR + (revR - dryR) * mix;
}

void Reverse::clean() {}

} // namespace bt
