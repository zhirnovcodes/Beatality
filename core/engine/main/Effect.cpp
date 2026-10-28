#include "Effect.h"

namespace bt {

void Effect::apply(float dryL, float dryR, int, float, double, double, double, float& outL, float& outR) {
    outL = dryL;
    outR = dryR;
}

void Effect::clean() {}

} // namespace bt
