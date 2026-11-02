#pragma once

#include "Effect.h"

#include <memory>

namespace bt {

// 4 ms at a 1/16 beat, 10 ms at 2 beats. The delay echo and the reversed copy both use this.
int attackFrames(double beats, double sampleRate);

// Circular delay of the dry frames received since clean().
// The buffer holds 4 seconds, which is 2 beats at 30 BPM. Allocated with the engine.
// The beat length is the time offset. The wet mix is also the feedback, so a higher
// power rings for longer. Until the first delayed sample has arrived, the wet signal is the dry frame.
// That echo then opens over 4 ms at a 1/16 beat and 10 ms at 2 beats.
class Delay {
public:
    explicit Delay(double sampleRate);

    void apply(float* l, float* r, const SampleBuffer& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
               const EffectParams& params);
    void clean();

private:
    // Owned here so moving a bank, which the fade does, keeps the same line.
    std::unique_ptr<float[]> left_;
    std::unique_ptr<float[]> right_;
    int capacity_ = 0;
    int write_ = 0;
    // Frames stored since clean. A read older than this has not arrived yet.
    int filled_ = 0;
    // Frames since the echo arrived. The opening fade uses this.
    int attacked_ = 0;
    bool quiet_ = true;
};

} // namespace bt
