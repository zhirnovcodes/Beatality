#pragma once

#include "Reverb.h"

namespace bt {

// The effects on one slice slot. Binding a different slot clears the previous state.
class EffectsBank {
public:
    explicit EffectsBank(double sampleRate);

    void bind(int slot);
    void clean();
    void apply(float dryL, float dryR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR);

private:
    int slot_ = -1;
    Reverb reverb_;
};

} // namespace bt
