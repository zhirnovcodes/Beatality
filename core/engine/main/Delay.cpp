#include "Delay.h"

#include <cmath>
#include <new>

namespace bt {

namespace {

// Full power is a long tail that still dies. Unity feedback would hold forever.
constexpr float kFeedback = 0.95f;
constexpr double kAttackBeatMin = 1.0 / 16.0;
constexpr double kAttackBeatMax = 2.0;
constexpr double kAttackMsMin = 4.0;
constexpr double kAttackMsMax = 10.0;

} // namespace

// 4 ms at 1/16, 10 ms at 2. Inverse lerp of the beat length, then the fade length.
int attackFrames(double beats, double sampleRate) {
    double t = (beats - kAttackBeatMin) / (kAttackBeatMax - kAttackBeatMin);
    if (t < 0.0) {
        t = 0.0;
    } else if (t > 1.0) {
        t = 1.0;
    }
    const double ms = kAttackMsMin + t * (kAttackMsMax - kAttackMsMin);
    const int frames = static_cast<int>(ms * 0.001 * sampleRate + 0.5);
    return frames > 0 ? frames : 1;
}

Delay::Delay(double sampleRate) {
    const int frames = static_cast<int>(std::llround(sampleRate * 4.0));
    capacity_ = frames > 0 ? frames : 1;
    left_.reset(new (std::nothrow) float[static_cast<std::size_t>(capacity_)]());
    right_.reset(new (std::nothrow) float[static_cast<std::size_t>(capacity_)]());
}

Frame Delay::apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                   const EffectParams& params) {
    const float wet = params.power;
    const double beats = params.beats;
    const double sampleRate = settings.sampleRate;
    const double bpm = settings.bpm;
    // beats * 60 / bpm is the offset in seconds. Clamp it to the line.
    const double limit = static_cast<double>(capacity_);
    double frames = beats * 60.0 / bpm * sampleRate;
    if (frames > limit) {
        frames = limit;
    }
    int delay = static_cast<int>(frames + 0.5);
    if (delay < 0) {
        delay = 0;
    } else if (delay > capacity_) {
        delay = capacity_;
    }
    const float mix = wet < 0.0f ? 0.0f : (wet > 1.0f ? 1.0f : wet);
    const float feedback = mix * kFeedback;
    const int attack = attackFrames(beats, sampleRate);

    const Frame dry = slice.read(clock.localIn(params.slot, settings, grid));
    const float dryL = dry.l;
    const float dryR = dry.r;
    float echoL = 0.0f;
    float echoR = 0.0f;
    float open = 1.0f;
    const bool arrived = delay > 0 && filled_ >= delay;
    if (arrived) {
        int read = write_ - delay;
        if (read < 0) {
            read += capacity_;
        }
        echoL = left_[static_cast<std::size_t>(read)];
        echoR = right_[static_cast<std::size_t>(read)];
        if (attacked_ < attack) {
            open = static_cast<float>(attacked_) / static_cast<float>(attack);
            ++attacked_;
        }
    }
    // The feedback takes the echo as it opens. A raw echo would write its first sample as a step into the line,
    // and every later repeat would play that step as a click.
    float inL = dryL + echoL * open * feedback;
    float inR = dryR + echoR * open * feedback;
    if (inL > -1.0e-15f && inL < 1.0e-15f) {
        inL = 0.0f;
    }
    if (inR > -1.0e-15f && inR < 1.0e-15f) {
        inR = 0.0f;
    }
    left_[static_cast<std::size_t>(write_)] = inL;
    right_[static_cast<std::size_t>(write_)] = inR;
    if (++write_ >= capacity_) {
        write_ = 0;
    }
    if (filled_ < capacity_) {
        ++filled_;
    }

    float delayedL = dryL;
    float delayedR = dryR;
    if (arrived) {
        delayedL = dryL + (echoL - dryL) * open;
        delayedR = dryR + (echoR - dryR) * open;
    }
    quiet_ = false;
    return {dryL + (delayedL - dryL) * mix, dryR + (delayedR - dryR) * mix};
}

void Delay::clean() {
    if (quiet_) {
        return;
    }
    // The line is not zeroed. A read waits until filled_ reaches the delay, and with write_ back at 0
    // that only reaches frames written since this clean. Zeroing 4 seconds here cost a spike on every slice.
    write_ = 0;
    filled_ = 0;
    attacked_ = 0;
    quiet_ = true;
}

} // namespace bt
