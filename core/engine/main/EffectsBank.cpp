#include "EffectsBank.h"

namespace bt {

EffectsBank::EffectsBank(double sampleRate, std::uint64_t seed)
    : reverb_(sampleRate), delay_(sampleRate), flanger_(sampleRate), trance_(seed), shift_(sampleRate) {}

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
    reverse_.clean();
    filter_.clean();
    flanger_.clean();
    trance_.clean();
    shift_.clean();
}

void EffectsBank::apply(EffectId effect, float dryL, float dryR, float revL, float revR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR) {
    if (effect == EffectId::Reverb) {
        reverb_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    if (effect == EffectId::Delay) {
        delay_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    if (effect == EffectId::Reverse) {
        reverse_.apply(dryL, dryR, revL, revR, wet, outL, outR);
        return;
    }
    if (effect == EffectId::Filter) {
        filter_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    if (effect == EffectId::Flanger) {
        flanger_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    if (effect == EffectId::Trance) {
        trance_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    if (effect == EffectId::Shift) {
        shift_.apply(dryL, dryR, pos, wet, beats, sampleRate, bpm, outL, outR);
        return;
    }
    outL = dryL;
    outR = dryR;
}

} // namespace bt
