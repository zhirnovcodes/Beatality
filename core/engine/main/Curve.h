#pragma once

namespace bt {

// Fade length in output samples. About 2 ms, and at most half the slice.
// A slice under two frames does not fade.
int fadeLength(double sampleRate, double sliceSec);

// y(x) in 0..1. x is a sample position the caller already has.
// The rise follows x. stop() keeps the gain at that x and the fall follows from there.
class Curve {
public:
    void setLength(int frames);
    float y(int x) const;
    void stop(int x);

    bool fadingOut() const { return target_ == 0.0f; }

private:
    float rise(int x) const;

    int length_ = 1;
    int fadeOutElapsed_ = 0;
    float target_ = 1.0f;
};

} // namespace bt
