#pragma once

#include "Effect.h"
#include "Rng.h"

namespace bt {

// Bandpass. An LFO moves the frequency from 100 to 10000, one cycle per beat.
// Power sets resonance, dry, wet, and output velocity. Those settings are in Filter.cpp.
class Filter {
public:
    explicit Filter(std::uint64_t seed);

    Frame apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                const EffectParams& params);
    void clean();

private:
    Rng rng_;
    bool armed_ = true;
    double phase_ = 0;
    float z1L_ = 0.0f;
    float z2L_ = 0.0f;
    float z1R_ = 0.0f;
    float z2R_ = 0.0f;
    bool quiet_ = true;
};

} // namespace bt
