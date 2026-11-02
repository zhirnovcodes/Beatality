#pragma once

#include "Clock.h"
#include "SampleBank.h"

namespace bt {

// Knobs for this sample. Reverse reads a nearby frame of the slice it is given.
struct EffectParams {
    float power = 0;
    double beats = 1;
    SampleSettings play{};
    int slot = 0;
    int maxSlices = 0;
};

// One slice effect. apply writes this sample. The slice is the buffer the voice is rendering.
// clean drops leftover state. This effect passes the dry sample through.
class Effect {
public:
    void apply(float* l, float* r, const SampleBuffer& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
               const EffectParams& params);
    void clean();
};

} // namespace bt
