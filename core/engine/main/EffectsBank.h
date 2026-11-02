#pragma once

#include "Effect.h"
#include "Delay.h"
#include "Filter.h"
#include "Flanger.h"
#include "Reverb.h"
#include "Reverse.h"
#include "Sequence.h"
#include "Shift.h"
#include "Trance.h"

namespace bt {

// The effects on one slice slot. Binding a different slot clears the previous state.
class EffectsBank {
public:
    explicit EffectsBank(double sampleRate, std::uint64_t seed);

    void bind(int slot);
    void clean();
    void apply(EffectId effect, float* l, float* r, const SampleBuffer& slice, const ClockSettings& settings, const Clock& clock,
               const SliceGrid& grid, const EffectParams& params);

private:
    int slot_ = -1;
    Reverb reverb_;
    Delay delay_;
    Reverse reverse_;
    Filter filter_;
    Flanger flanger_;
    Trance trance_;
    Shift shift_;
};

} // namespace bt
