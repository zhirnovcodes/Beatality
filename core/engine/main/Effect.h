#pragma once

#include "SampleBank.h"

namespace bt {

// This sample's clock. beats is its position from the start of the loop.
struct Playhead {
    double beats = 0;
    double bpm = 120;
    double sampleRate = 44100;
};

// Knobs for this sample. Reverse also reads the source window. Other effects leave it unread.
struct EffectParams {
    float power = 0;
    double beats = 1;
    const SampleBuffer* source = nullptr;
    TrackPlay play{};
    int slot = 0;
    int local = 0;
    int sliceFrames = 0;
    int maxSlices = 0;
};

// One slice effect. apply mixes this sample in place. clean drops leftover state.
// This effect passes the dry sample through.
class Effect {
public:
    void apply(float* l, float* r, const Playhead& playhead, const EffectParams& params);
    void clean();
};

} // namespace bt
