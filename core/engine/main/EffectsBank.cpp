#include "EffectsBank.h"

namespace bt {

EffectsBank::EffectsBank(double sampleRate) : reverb_(sampleRate), delay_(sampleRate) {}

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
    delay_.clean();
}

void EffectsBank::apply(EffectId effect, float dryL, float dryR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR) {
    if (effect == EffectId::Reverb) {
        reverb_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    if (effect == EffectId::Delay) {
        delay_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    outL = dryL;
    outR = dryR;
}

} // namespace bt
