#include "Curve.h"

#include <cmath>

namespace bt {

int fadeLength(double sampleRate, double sliceSec, double attackSec) {
    const int sliceFrames = static_cast<int>(std::llround(sliceSec * sampleRate));
    if (sliceFrames < 2) {
        return 0;
    }
    const int half = sliceFrames / 2;
    const long fade = std::lround(attackSec * sampleRate);
    const int frames = fade < 1 ? 1 : static_cast<int>(fade);
    return frames < half ? frames : half;
}

void Curve::setLength(int frames) { length_ = frames; }

float Curve::rise(int x) const {
    if (length_ <= 0 || x >= length_) {
        return 1.0f;
    }
    if (x <= 0) {
        return 0.0f;
    }
    return static_cast<float>(x) / static_cast<float>(length_);
}

float Curve::y(int x) const {
    if (target_ == 1.0f) {
        return rise(x);
    }
    const float from = rise(fadeOutElapsed_);
    return from * (1.0f - rise(x - fadeOutElapsed_));
}

void Curve::stop(int x) {
    fadeOutElapsed_ = x;
    target_ = 0.0f;
}

} // namespace bt
