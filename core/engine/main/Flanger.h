#pragma once

#include "Effect.h"
#include "Rng.h"

#include <memory>

namespace bt {

// A short delay mixed with the dry sample. A sine walks the delay from 0.5 ms to 8 ms, one cycle per beat.
// Power sets feedback and the dry/wet mix. Those settings are in Flanger.cpp.
class Flanger {
public:
    Flanger(double sampleRate, std::uint64_t seed);

    Frame apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                const EffectParams& params);
    void clean();

private:
    // Owned here so moving a bank, which the fade does, keeps the same line.
    std::unique_ptr<float[]> left_;
    std::unique_ptr<float[]> right_;
    int capacity_ = 0;
    int write_ = 0;
    Rng rng_;
    bool armed_ = true;
    double phase_ = 0;
    bool quiet_ = true;
    // 0 when a slice starts, rises to 1 over kRiseMs. Scales the feedback,
    // so the frames written after the pre-fill join it without a step.
    float rise_ = 0;
};

} // namespace bt
