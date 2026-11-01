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

void readFrame(const SampleBuffer& buffer, int frame, float& left, float& right) {
    if (frame < 0 || frame >= buffer.frames) {
        left = 0.0f;
        right = 0.0f;
        return;
    }
    left = buffer.left[frame];
    right = buffer.right[frame];
}

} // namespace

void Reverse::apply(float* l, float* r, const Playhead& playhead, const EffectParams& params) {
    const float dryL = *l;
    const float dryR = *r;
    const int slice = params.sliceFrames;
    const double framesPerBeat = playhead.sampleRate * 60.0 / playhead.bpm;
    const double sliceBeats = static_cast<double>(slice) / framesPerBeat;
    int parts = static_cast<int>(std::llround(sliceBeats / params.beats));
    if (parts < 1) {
        parts = 1;
    }
    int part = slice / parts;
    if (part < 1) {
        part = 1;
    }
    const PartRead read = partRead(params.local, slice, part, parts);
    float revL = 0.0f;
    float revR = 0.0f;
    readFrame(*params.source, frameAt(*params.source, params.play, params.slot, read.mirrored, slice, params.maxSlices), revL, revR);
    voiceGain(params.play, revL, revR);
    const float env = copyEnvelope(read.offset, read.length, attackFrames(params.beats, playhead.sampleRate));
    const float shapedL = dryL + (revL - dryL) * env;
    const float shapedR = dryR + (revR - dryR) * env;
    float mix = params.power;
    if (mix < 0.0f) {
        mix = 0.0f;
    } else if (mix > 1.0f) {
        mix = 1.0f;
    }
    *l = dryL + (shapedL - dryL) * mix;
    *r = dryR + (shapedR - dryR) * mix;
}

void Reverse::clean() {}

} // namespace bt
