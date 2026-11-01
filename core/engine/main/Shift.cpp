#include "Shift.h"

#include <cmath>

namespace bt {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr float kWidthHz = 1000.0f;

// Power 0 is dry. Power 1 replaces the sample with the shifted one.
// Width is the deviation in hertz. The sine runs from -1 to 1, so power 1 reaches -1000 and +1000.
struct Settings {
    float width;
    float dry;
    float wet;
};

constexpr Settings kPower0{0.0f, 1.0f, 0.0f};
constexpr Settings kPower1{kWidthHz, 0.0f, 1.0f};

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
    settings.width = blend(kPower0.width, kPower1.width, t);
    settings.dry = blend(kPower0.dry, kPower1.dry, t);
    settings.wet = blend(kPower0.wet, kPower1.wet, t);
    return settings;
}

void flush(float& value) {
    if (value > -1.0e-15f && value < 1.0e-15f) {
        value = 0.0f;
    }
}

} // namespace

Shift::Shift(double) {
    // The kernel is in fractions of the sample rate, so the engine rate is not used.
    // Odd-length Hilbert FIR. The in-phase path is a delay of the same length, so the pair is analytic.
    for (int n = 0; n < kTaps; ++n) {
        const int k = n - kDelay;
        double weight = 0.0;
        if (k != 0 && (k & 1) != 0) {
            weight = 2.0 / (kPi * static_cast<double>(k));
        }
        const double window = 0.54 - 0.46 * std::cos(2.0 * kPi * static_cast<double>(n) / static_cast<double>(kTaps - 1));
        kernel_[n] = weight * window;
    }
    double real = 0.0;
    double imag = 0.0;
    for (int n = 0; n < kTaps; ++n) {
        const double angle = 0.5 * kPi * static_cast<double>(n);
        real += kernel_[n] * std::cos(angle);
        imag -= kernel_[n] * std::sin(angle);
    }
    const double gain = std::sqrt(real * real + imag * imag);
    for (int n = 0; n < kTaps; ++n) {
        kernel_[n] /= gain;
    }
}

float Shift::channel(float* line, float x, double cosine, double sine) {
    line[write_] = x;
    double quad = 0.0;
    for (int n = 0; n < kTaps; ++n) {
        int index = write_ - n;
        if (index < 0) {
            index += kTaps;
        }
        quad += kernel_[n] * static_cast<double>(line[index]);
    }
    int mid = write_ - kDelay;
    if (mid < 0) {
        mid += kTaps;
    }
    const double inPhase = static_cast<double>(line[mid]);
    // Upward when the sine is positive: the quadrature part is subtracted.
    float shifted = static_cast<float>(inPhase * cosine - quad * sine);
    flush(shifted);
    return shifted;
}

void Shift::apply(float* l, float* r, const Playhead& playhead, const EffectParams& params) {
    const float dryL = *l;
    const float dryR = *r;
    const float power = params.power;
    const double beats = params.beats;
    const double sampleRate = playhead.sampleRate;
    const double bpm = playhead.bpm;
    // One beat is one cycle. The sine is the shift, from -width to +width.
    const double lfo = std::sin(phase_ * 2.0 * kPi);
    const double cycle = beats * sampleRate * 60.0 / bpm;
    phase_ += 1.0 / cycle;
    phase_ -= std::floor(phase_);

    const Settings settings = settingsFor(power);
    osc_ += lfo * static_cast<double>(settings.width) / sampleRate;
    osc_ -= std::floor(osc_);
    const double angle = osc_ * 2.0 * kPi;
    const double cosine = std::cos(angle);
    const double sine = std::sin(angle);

    const float wetL = channel(left_, dryL, cosine, sine);
    const float wetR = channel(right_, dryR, cosine, sine);
    if (++write_ >= kTaps) {
        write_ = 0;
    }

    *l = dryL * settings.dry + wetL * settings.wet;
    *r = dryR * settings.dry + wetR * settings.wet;
    quiet_ = false;
}

void Shift::clean() {
    if (quiet_) {
        return;
    }
    for (int i = 0; i < kTaps; ++i) {
        left_[i] = 0.0f;
        right_[i] = 0.0f;
    }
    write_ = 0;
    phase_ = 0.0;
    osc_ = 0.0;
    quiet_ = true;
}

} // namespace bt
