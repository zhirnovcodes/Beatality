#pragma once

#include "Effect.h"
#include "Rng.h"

namespace bt {

// Frequency shifter. A sine walks from -1 to 1, one cycle per beat, and moves every frequency by the same amount.
// Power sets the width and the dry/wet mix. Those settings are in Shift.cpp.
// Power 1 reaches -1000 Hz and +1000 Hz.
class Shift {
public:
    Shift(double sampleRate, std::uint64_t seed);

    Frame apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                const EffectParams& params);
    void clean();

private:
    static constexpr int kTaps = 127;
    static constexpr int kDelay = (kTaps - 1) / 2;

    float left_[kTaps]{};
    float right_[kTaps]{};
    double kernel_[kTaps]{};
    int write_ = 0;
    Rng rng_;
    bool armed_ = true;
    double phase_ = 0;
    double osc_ = 0;
    bool quiet_ = true;

    float channel(float* line, float x, double cosine, double sine);
};

} // namespace bt
