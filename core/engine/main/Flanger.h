#pragma once

#include "Effect.h"

#include <memory>

namespace bt {

// A short delay mixed with the dry sample. A sine walks the delay from 0.5 ms to 8 ms, one cycle per beat.
// Power sets feedback and the dry/wet mix. Those settings are in Flanger.cpp.
class Flanger {
public:
    explicit Flanger(double sampleRate);

    void apply(float* l, float* r, const SampleBuffer& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
               const EffectParams& params);
    void clean();

private:
    // Owned here so moving a bank, which the fade does, keeps the same line.
    std::unique_ptr<float[]> left_;
    std::unique_ptr<float[]> right_;
    int capacity_ = 0;
    int write_ = 0;
    double phase_ = 0;
    bool quiet_ = true;
};

} // namespace bt
