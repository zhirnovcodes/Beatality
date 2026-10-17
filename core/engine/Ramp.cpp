#include "Ramp.h"

#include <cmath>

namespace bt {

namespace {

constexpr double kFadeSeconds = 0.010;
constexpr double kHalfPi = 1.5707963267948966;

double progress(int frame, int length) {
    if (length <= 0 || frame >= length) {
        return 1.0;
    }
    if (frame <= 0) {
        return 0.0;
    }
    return static_cast<double>(frame) / length;
}

} // namespace

int fadeFrames(double sampleRate) {
    const long frames = std::lround(kFadeSeconds * sampleRate);
    return frames < 1 ? 1 : static_cast<int>(frames);
}

float fadeInGain(int frame, int length) {
    return static_cast<float>(std::sin(progress(frame, length) * kHalfPi));
}

float fadeOutGain(int frame, int length) {
    return static_cast<float>(std::cos(progress(frame, length) * kHalfPi));
}

} // namespace bt
