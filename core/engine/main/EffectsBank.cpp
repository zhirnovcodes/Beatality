#include "EffectsBank.h"

namespace bt {

EffectsBank::EffectsBank(double sampleRate, std::uint64_t seed)
    : reverb_(sampleRate), delay_(sampleRate), filter_(seed + 11), flanger_(sampleRate, seed + 12), trance_(seed),
      shift_(sampleRate, seed + 13) {}

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

Frame EffectsBank::apply(EffectId effect, const SliceReader& slice, const ClockSettings& settings, const Clock& clock,
                         const SliceGrid& grid, const EffectParams& params) {
    if (effect == EffectId::Reverb) {
        return reverb_.apply(slice, settings, clock, grid, params);
    }
    if (effect == EffectId::Delay) {
        return delay_.apply(slice, settings, clock, grid, params);
    }
    if (effect == EffectId::Reverse) {
        return reverse_.apply(slice, settings, clock, grid, params);
    }
    if (effect == EffectId::Filter) {
        return filter_.apply(slice, settings, clock, grid, params);
    }
    if (effect == EffectId::Flanger) {
        return flanger_.apply(slice, settings, clock, grid, params);
    }
    if (effect == EffectId::Trance) {
        return trance_.apply(slice, settings, clock, grid, params);
    }
    if (effect == EffectId::Shift) {
        return shift_.apply(slice, settings, clock, grid, params);
    }
    return slice.read(clock.localIn(params.slot, settings, grid));
}

} // namespace bt
