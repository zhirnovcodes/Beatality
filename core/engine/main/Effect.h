#pragma once

#include "Clock.h"
#include "SliceReader.h"

namespace bt {

// Knobs for this sample. slot is the slice the voice is playing.
struct EffectParams {
    float power = 0;
    double beats = 1;
    int slot = 0;
};

// One slice effect. apply reads the slice it is given and returns this sample.
// clean drops leftover state. This effect returns the dry sample.
class Effect {
public:
    Frame apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                const EffectParams& params);
    void clean();
};

} // namespace bt
