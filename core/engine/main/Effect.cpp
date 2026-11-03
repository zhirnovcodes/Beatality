#include "Effect.h"

namespace bt {

Frame Effect::apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                    const EffectParams& params) {
    return slice.read(clock.localIn(params.slot, settings, grid));
}

void Effect::clean() {}

} // namespace bt
