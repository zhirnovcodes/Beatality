#include "EffectsBank.h"

namespace bt {

EffectsBank::EffectsBank(double sampleRate) : reverb_(sampleRate) {}

void EffectsBank::bind(int slot) {
    if (slot == slot_) {
        return;
    }
    clean();
    slot_ = slot;
}

void EffectsBank::clean() {
    slot_ = -1;
    reverb_.clean();
}

void EffectsBank::apply(float dryL, float dryR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR) {
    reverb_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
}

} // namespace bt
