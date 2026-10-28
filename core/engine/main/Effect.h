#pragma once

namespace bt {

// One slice effect. apply mixes this sample. clean drops leftover state.
// This effect passes the dry sample through.
class Effect {
public:
    void apply(float dryL, float dryR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR);
    void clean();
};

} // namespace bt
