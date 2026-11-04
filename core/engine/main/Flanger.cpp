#include "Flanger.h"

#include <cmath>
#include <new>

namespace bt {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDelayMsMin = 0.5;
constexpr double kDelayMsMax = 8.0;

// Power 0 is dry. Power 1 is an even mix, where the sweep can cancel.
// Feedback opens with power. It stays under 1, so the ring dies.
struct Settings {
    float feedback;
    float dry;
    float wet;
};

constexpr Settings kPower0{0.0f, 1.0f, 0.0f};
constexpr Settings kPower1{0.7f, 0.5f, 0.5f};

float blend(float from, float to, float power) {
    return from + (to - from) * power;
}

Settings settingsFor(float power) {
    float t = power;
    if (t < 0.0f) {
        t = 0.0f;
    } else if (t > 1.0f) {
        t = 1.0f;
    }
    Settings settings;
    settings.feedback = blend(kPower0.feedback, kPower1.feedback, t);
    settings.dry = blend(kPower0.dry, kPower1.dry, t);
    settings.wet = blend(kPower0.wet, kPower1.wet, t);
    return settings;
}

void flush(float& value) {
    if (value > -1.0e-15f && value < 1.0e-15f) {
        value = 0.0f;
    }
}

// delay is in frames, at least one behind the write head. frac pulls in the next older frame.
float tap(const float* line, int capacity, int write, double delay) {
    const int behind = static_cast<int>(delay);
    const float frac = static_cast<float>(delay - static_cast<double>(behind));
    int near = write - behind;
    if (near < 0) {
        near += capacity;
    }
    int far = near - 1;
    if (far < 0) {
        far += capacity;
    }
    const float newer = line[static_cast<std::size_t>(near)];
    const float older = line[static_cast<std::size_t>(far)];
    return newer + (older - newer) * frac;
}

} // namespace

Flanger::Flanger(double sampleRate, std::uint64_t seed) : rng_(seed) {
    const int frames = static_cast<int>(std::llround(sampleRate * kDelayMsMax * 0.001)) + 4;
    capacity_ = frames > 4 ? frames : 4;
    left_.reset(new (std::nothrow) float[static_cast<std::size_t>(capacity_)]());
    right_.reset(new (std::nothrow) float[static_cast<std::size_t>(capacity_)]());
}

Frame Flanger::apply(const SliceReader& slice, const ClockSettings& clockSettings, const Clock& clock, const SliceGrid& grid,
                     const EffectParams& params) {
    const float power = params.power;
    const double beats = params.beats;
    const double sampleRate = clockSettings.sampleRate;
    const double bpm = clockSettings.bpm;
    const Settings settings = settingsFor(power);
    const double cycle = beats * sampleRate * 60.0 / bpm;
    const double limit = static_cast<double>(capacity_ - 2);

    const Frame dry = slice.read(clock.localIn(params.slot, clockSettings, grid));
    const float dryL = dry.l;
    const float dryR = dry.r;
    if (armed_) {
        // Each slice starts the LFO at 90, 180, or 270 degrees.
        phase_ = 0.25 * static_cast<double>(1 + rng_.nextInt(3));
        armed_ = false;
    }
    // One beat is one cycle. The sine walks the delay from 0.5 ms to 8 ms.
    const double along = 0.5 * (std::sin(phase_ * 2.0 * kPi) + 1.0);
    double delay = (kDelayMsMin + along * (kDelayMsMax - kDelayMsMin)) * 0.001 * sampleRate;
    if (delay < 1.0) {
        delay = 1.0;
    } else if (delay > limit) {
        delay = limit;
    }
    phase_ += 1.0 / cycle;
    phase_ -= std::floor(phase_);

    const float echoL = tap(left_.get(), capacity_, write_, delay);
    const float echoR = tap(right_.get(), capacity_, write_, delay);
    float inL = dryL + echoL * settings.feedback;
    float inR = dryR + echoR * settings.feedback;
    flush(inL);
    flush(inR);
    left_[static_cast<std::size_t>(write_)] = inL;
    right_[static_cast<std::size_t>(write_)] = inR;
    if (++write_ >= capacity_) {
        write_ = 0;
    }

    quiet_ = false;
    return {dryL * settings.dry + echoL * settings.wet, dryR * settings.dry + echoR * settings.wet};
}

void Flanger::clean() {
    armed_ = true;
    if (quiet_) {
        return;
    }
    for (int i = 0; i < capacity_; ++i) {
        left_[static_cast<std::size_t>(i)] = 0.0f;
        right_[static_cast<std::size_t>(i)] = 0.0f;
    }
    write_ = 0;
    phase_ = 0.0;
    quiet_ = true;
}

} // namespace bt
