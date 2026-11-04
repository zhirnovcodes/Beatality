#include "Filter.h"

#include <cmath>

namespace bt {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr float kFreqMin = 100.0f;
constexpr float kFreqMax = 10000.0f;

// Power 0 is dry. Power 1 opens the band. Velocity is lower because the resonance lifts the peak.
struct Settings {
    float resonance;
    float dry;
    float wet;
    float velocity;
};

constexpr Settings kPower0{0.0f, 1.0f, 0.0f, 1.0f};
constexpr Settings kPower1{0.5f, 0.1f, 0.9f, 1.0f};

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
    settings.resonance = blend(kPower0.resonance, kPower1.resonance, t);
    settings.dry = blend(kPower0.dry, kPower1.dry, t);
    settings.wet = blend(kPower0.wet, kPower1.wet, t);
    settings.velocity = blend(kPower0.velocity, kPower1.velocity, t);
    return settings;
}

// The cookbook bandpass peaks at Q. Resonance 0 is Q 1. Resonance 0.5 is Q 2.
float qFor(float resonance) {
    return 1.0f / (1.0f - resonance);
}

void flush(float& value) {
    if (value > -1.0e-15f && value < 1.0e-15f) {
        value = 0.0f;
    }
}

struct Coeff {
    float b0 = 0.0f;
    float b2 = 0.0f;
    float a1 = 0.0f;
    float a2 = 0.0f;
};

// Constant-skirt bandpass. The peak gain is Q.
Coeff bandpass(float frequency, float q, double sampleRate) {
    const double w0 = 2.0 * kPi * static_cast<double>(frequency) / sampleRate;
    const double sine = std::sin(w0);
    const double cosine = std::cos(w0);
    const double alpha = sine / (2.0 * static_cast<double>(q));
    const double a0 = 1.0 + alpha;
    Coeff coeff;
    coeff.b0 = static_cast<float>((sine * 0.5) / a0);
    coeff.b2 = static_cast<float>((-sine * 0.5) / a0);
    coeff.a1 = static_cast<float>((-2.0 * cosine) / a0);
    coeff.a2 = static_cast<float>((1.0 - alpha) / a0);
    return coeff;
}

float step(float& z1, float& z2, float x, const Coeff& coeff) {
    const float y = coeff.b0 * x + z1;
    z1 = -coeff.a1 * y + z2;
    z2 = coeff.b2 * x - coeff.a2 * y;
    flush(z1);
    flush(z2);
    return y;
}

} // namespace

Filter::Filter(std::uint64_t seed) : rng_(seed) {}

Frame Filter::apply(const SliceReader& slice, const ClockSettings& clockSettings, const Clock& clock, const SliceGrid& grid,
                    const EffectParams& params) {
    const float power = params.power;
    const double beats = params.beats;
    const double sampleRate = clockSettings.sampleRate;
    const double bpm = clockSettings.bpm;
    const Settings settings = settingsFor(power);
    const double cycle = beats * sampleRate * 60.0 / bpm;
    const float limit = static_cast<float>(sampleRate) * 0.49f;

    const Frame dry = slice.read(clock.localIn(params.slot, clockSettings, grid));
    const float dryL = dry.l;
    const float dryR = dry.r;
    if (armed_) {
        // Each slice starts the LFO at 90, 180, or 270 degrees.
        phase_ = 0.25 * static_cast<double>(1 + rng_.nextInt(3));
        armed_ = false;
    }
    // One beat is one cycle. The sine walks from 100 to 10000 in octaves.
    const double along = 0.5 * (std::sin(phase_ * 2.0 * kPi) + 1.0);
    float frequency = static_cast<float>(static_cast<double>(kFreqMin) * std::pow(static_cast<double>(kFreqMax / kFreqMin), along));
    if (frequency > limit) {
        frequency = limit;
    }
    phase_ += 1.0 / cycle;
    phase_ -= std::floor(phase_);

    const Coeff coeff = bandpass(frequency, qFor(settings.resonance), sampleRate);
    const float bandL = step(z1L_, z2L_, dryL, coeff);
    const float bandR = step(z1R_, z2R_, dryR, coeff);
    quiet_ = false;
    return {(dryL * settings.dry + bandL * settings.wet) * settings.velocity, (dryR * settings.dry + bandR * settings.wet) * settings.velocity};
}

void Filter::clean() {
    armed_ = true;
    if (quiet_) {
        return;
    }
    phase_ = 0.0;
    z1L_ = 0.0f;
    z2L_ = 0.0f;
    z1R_ = 0.0f;
    z2R_ = 0.0f;
    quiet_ = true;
}

} // namespace bt
