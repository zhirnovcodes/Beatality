#pragma once

namespace bt {

// A value that moves to the one it was set to in a straight line over kChangeSec.
// A new value set mid-move starts a new line from wherever it is now.
class Interpolator {
public:
    static constexpr double kChangeSec = 0.005;

    explicit Interpolator(float value = 0);

    // The value to move to. Setting the same value again does not restart the move.
    void set(float value);
    float get() const { return value_; }
    // Moves on by this many seconds. The caller passes one frame, 1 / sampleRate.
    void tick(double seconds);

private:
    float value_;
    float target_;
    // Units per second, signed, fixed when set() is called.
    double rate_ = 0;
};

} // namespace bt
