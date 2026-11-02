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

void EffectsBank::apply(EffectId effect, float* l, float* r, const SampleBuffer& slice, const ClockSettings& settings, const Clock& clock,
                        const SliceGrid& grid, const EffectParams& params) {
    if (effect == EffectId::Reverb) {
        reverb_.apply(l, r, slice, settings, clock, grid, params);
        return;
    }
    if (effect == EffectId::Delay) {
        delay_.apply(l, r, slice, settings, clock, grid, params);
        return;
    }
    if (effect == EffectId::Reverse) {
        reverse_.apply(l, r, slice, settings, clock, grid, params);
        return;
    }
    if (effect == EffectId::Filter) {
        filter_.apply(l, r, slice, settings, clock, grid, params);
        return;
    }
    if (effect == EffectId::Flanger) {
        flanger_.apply(l, r, slice, settings, clock, grid, params);
        return;
    }
    if (effect == EffectId::Trance) {
        trance_.apply(l, r, slice, settings, clock, grid, params);
        return;
    }
    if (effect == EffectId::Shift) {
        shift_.apply(l, r, slice, settings, clock, grid, params);
        return;
    }
}

} // namespace bt
