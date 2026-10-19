#include "Voice.h"

#include "Ramp.h"

namespace bt {

void Voice::start(const SampleBuffer& buffer, int fadeLength) {
    if (!buffer.valid()) {
        cut();
        return;
    }
    buffer_ = buffer;
    cursor_ = 0;
    // A fade longer than half the file would skip past the end on the first wrap.
    loopFade_ = fadeLength > 0 && buffer.frames > fadeLength * 2 ? fadeLength : 0;
    ramp_ = Ramp::In;
    rampFrame_ = 0;
    rampLength_ = fadeLength < 1 ? 1 : fadeLength;
    active_ = true;
}

void Voice::fadeOut(int fadeLength) {
    if (!active_ || ramp_ == Ramp::Out) {
        return;
    }
    const int length = fadeLength < 1 ? 1 : fadeLength;
    int startFrame = 0;
    if (ramp_ == Ramp::In) {
        // Equal power: cos at (length - f) equals sin at f, so the gain stays continuous.
        const int heard = rampFrame_ * length / rampLength_;
        startFrame = length - heard;
    }
    ramp_ = Ramp::Out;
    rampFrame_ = startFrame;
    rampLength_ = length;
}

void Voice::cut() {
    active_ = false;
    ramp_ = Ramp::None;
    buffer_ = {};
    cursor_ = 0;
    loopFade_ = 0;
}

float Voice::gainAt(int rampFrame) const {
    switch (ramp_) {
    case Ramp::In:
        return fadeInGain(rampFrame, rampLength_);
    case Ramp::Out:
        return fadeOutGain(rampFrame, rampLength_);
    case Ramp::None:
        break;
    }
    return 1.0f;
}

void Voice::render(float* left, float* right, int frames) {
    for (int i = 0; i < frames && active_; ++i) {
        const float gain = gainAt(rampFrame_);
        float sampleL = buffer_.left[cursor_];
        float sampleR = buffer_.right[cursor_];
        // The head of the file is mixed in over the last fade, then skipped,
        // so it is not played twice and the join has no click.
        if (loopFade_ > 0 && cursor_ >= buffer_.frames - loopFade_) {
            // Linear, not equal-power: the end and the start are the same
            // recording, and equal-power would swell by 3 dB on every loop.
            const int k = cursor_ - (buffer_.frames - loopFade_);
            const float t = static_cast<float>(k) / static_cast<float>(loopFade_);
            sampleL = sampleL * (1.0f - t) + buffer_.left[k] * t;
            sampleR = sampleR * (1.0f - t) + buffer_.right[k] * t;
        }
        left[i] += sampleL * gain;
        right[i] += sampleR * gain;

        if (++cursor_ >= buffer_.frames) {
            cursor_ = loopFade_;
        }
        if (ramp_ != Ramp::None && ++rampFrame_ >= rampLength_) {
            if (ramp_ == Ramp::Out) {
                cut();
            } else {
                ramp_ = Ramp::None;
            }
        }
    }
}

} // namespace bt
