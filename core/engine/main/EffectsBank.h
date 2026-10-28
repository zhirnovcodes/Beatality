#pragma once

#include "Delay.h"
#include "Reverb.h"
#include "Sequence.h"

namespace bt {

// The effects on one slice slot. Binding a different slot clears the previous state.
class EffectsBank {
public:
    explicit EffectsBank(double sampleRate);

    void bind(int slot);
    void clean();
    void apply(EffectId effect, float dryL, float dryR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR);

private:
    int slot_ = -1;
    Reverb reverb_;
    Delay delay_;
};

} // namespace bt
