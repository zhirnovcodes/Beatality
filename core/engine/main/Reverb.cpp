#include "Reverb.h"

#include <cmath>
#include <new>

namespace bt {

namespace {

constexpr float kDamp = 0.2f;
constexpr float kAllpass = 0.5f;
// Freeverb scales the comb sum down on the way in and back up for a full wet mix.
constexpr float kInputGain = 0.015f;
constexpr float kWetGain = 3.0f;

constexpr int kCombs[8] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
constexpr int kAllpasses[4] = {556, 441, 341, 225};
constexpr int kSpread = 23;

int lengthOf(int tuning, double sampleRate) {
    const int length = static_cast<int>(std::lround(static_cast<double>(tuning) * sampleRate / 44100.0));
    return length > 0 ? length : 1;
}

// Decay at full wet. 1/16, 1/8, 1/4, 1/2, 1, and 2 land on even steps from 0 to 0.9.
float feedbackFor(double beats) {
    const double t = (std::log2(beats) + 4.0) / 5.0;
    const double clamped = t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
    return static_cast<float>(clamped * 0.9);
}

} // namespace

Reverb::Reverb(double sampleRate) {
    int count = 0;
    auto place = [&](Stage& stage, int tuning) {
        stage.length = lengthOf(tuning, sampleRate);
        stage.offset = count;
        stage.index = 0;
        stage.store = 0.0f;
        count += stage.length;
    };
    for (int i = 0; i < 8; ++i) {
        place(combsL_[i], kCombs[i]);
        place(combsR_[i], kCombs[i] + kSpread);
    }
    for (int i = 0; i < 4; ++i) {
        place(allL_[i], kAllpasses[i]);
        place(allR_[i], kAllpasses[i] + kSpread);
    }
    bufferCount_ = count;
    buffer_.reset(new (std::nothrow) float[static_cast<std::size_t>(count)]());
}

float Reverb::comb(Stage& stage, float input, float feedback) {
    float& cell = buffer_[static_cast<std::size_t>(stage.offset + stage.index)];
    const float output = cell;
    stage.store = output * (1.0f - kDamp) + stage.store * kDamp;
    if (stage.store > -1.0e-15f && stage.store < 1.0e-15f) {
        stage.store = 0.0f;
    }
    cell = input + stage.store * feedback;
    if (++stage.index >= stage.length) {
        stage.index = 0;
    }
    return output;
}

float Reverb::allpass(Stage& stage, float input) {
    float& cell = buffer_[static_cast<std::size_t>(stage.offset + stage.index)];
    const float output = -input + cell;
    cell = input + cell * kAllpass;
    if (++stage.index >= stage.length) {
        stage.index = 0;
    }
    return output;
}

float Reverb::tank(Stage* combs, Stage* allpasses, float input, float feedback) {
    const float scaled = input * kInputGain;
    float mixed = 0.0f;
    for (int i = 0; i < 8; ++i) {
        mixed += comb(combs[i], scaled, feedback);
    }
    mixed *= kWetGain;
    for (int i = 0; i < 4; ++i) {
        mixed = allpass(allpasses[i], mixed);
    }
    return mixed;
}

void Reverb::apply(float* l, float* r, const SampleBuffer&, const ClockSettings&, const Clock&, const SliceGrid&,
                  const EffectParams& params) {
    const float wet = params.power;
    const double beats = params.beats;
    const float mix = wet < 0.0f ? 0.0f : (wet > 1.0f ? 1.0f : wet);
    const float feedback = feedbackFor(beats) * mix;
    const float dryL = *l;
    const float dryR = *r;
    const float wetL = tank(combsL_, allL_, dryL, feedback);
    const float wetR = tank(combsR_, allR_, dryR, feedback);
    *l = dryL + (wetL - dryL) * mix;
    *r = dryR + (wetR - dryR) * mix;
    quiet_ = false;
}

void Reverb::clean() {
    if (quiet_) {
        return;
    }
    for (int i = 0; i < bufferCount_; ++i) {
        buffer_[static_cast<std::size_t>(i)] = 0.0f;
    }
    for (int i = 0; i < 8; ++i) {
        combsL_[i].index = 0;
        combsL_[i].store = 0.0f;
        combsR_[i].index = 0;
        combsR_[i].store = 0.0f;
    }
    for (int i = 0; i < 4; ++i) {
        allL_[i].index = 0;
        allL_[i].store = 0.0f;
        allR_[i].index = 0;
        allR_[i].store = 0.0f;
    }
    quiet_ = true;
}

} // namespace bt
