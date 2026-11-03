#include "Reverse.h"

#include "Delay.h"

#include <cmath>

namespace bt {

namespace {

struct PartRead {
    int mirrored = 0;
    int offset = 0;
    int length = 0;
};

// Each part plays from its end back to its start. Frames before the slice
// continue that reverse past the first part, so the fade into the slice is the same line.
PartRead partRead(int local, int sliceFrames, int partFrames, int parts) {
    if (local < 0) {
        const int end = partFrames < sliceFrames ? partFrames : sliceFrames;
        return {end - 1 - local, local, end};
    }
    int index = local / partFrames;
    if (index >= parts) {
        index = parts - 1;
    }
    const int start = index * partFrames;
    const int end = index + 1 >= parts ? sliceFrames : start + partFrames;
    return {end - 1 - (local - start), local - start, end - start};
}

// The reversed copy rises from dry over the attack, holds, then falls back to dry.
// The same length closes the part, so the joins stay on the dry frame.
float copyEnvelope(int offset, int length, int attack) {
    if (offset < 0 || length <= 0 || attack <= 0) {
        return 0.0f;
    }
    float rise = static_cast<float>(offset) / static_cast<float>(attack);
    if (rise > 1.0f) {
        rise = 1.0f;
    }
    float fall = 1.0f;
    if (offset >= length - attack) {
        fall = static_cast<float>(length - 1 - offset) / static_cast<float>(attack);
        if (fall < 0.0f) {
            fall = 0.0f;
        }
    }
    return rise < fall ? rise : fall;
}

} // namespace

Frame Reverse::apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                     const EffectParams& params) {
    const int sliceFrames = clock.sliceFrames(settings, grid);
    const double framesPerBeat = settings.framesPerBeat();
    const double sliceBeats = static_cast<double>(sliceFrames) / framesPerBeat;
    int parts = static_cast<int>(std::llround(sliceBeats / params.beats));
    if (parts < 1) {
        parts = 1;
    }
    int part = sliceFrames / parts;
    if (part < 1) {
        part = 1;
    }
    const int attack = attackFrames(params.beats, settings.sampleRate);
    float mix = params.power;
    if (mix < 0.0f) {
        mix = 0.0f;
    } else if (mix > 1.0f) {
        mix = 1.0f;
    }

    const int local = clock.localIn(params.slot, settings, grid);
    const Frame dry = slice.read(local);
    const PartRead read = partRead(local, sliceFrames, part, parts);
    const Frame rev = slice.read(read.mirrored);
    const float env = copyEnvelope(read.offset, read.length, attack);
    const float shapedL = dry.l + (rev.l - dry.l) * env;
    const float shapedR = dry.r + (rev.r - dry.r) * env;
    return {dry.l + (shapedL - dry.l) * mix, dry.r + (shapedR - dry.r) * mix};
}

void Reverse::clean() {}

} // namespace bt
