#pragma once

#include "SampleBuffer.h"

#include <cstdint>

namespace bt {

// Reads one buffer from its first frame and loops it, under an optional
// fade-in or fade-out. The join at the loop is a short linear crossfade,
// so the restart is not a click.
class Voice {
public:
    void start(const SampleBuffer& buffer, int fadeLength);   // fades in from the first frame
    void fadeOut(int fadeLength);   // continues from the current gain
    void cut();

    // Adds this voice into L and R. Becomes inactive when a fade-out ends.
    void render(float* left, float* right, int frames);

    bool active() const { return active_; }
    std::uint32_t bufferId() const { return buffer_.id; }

private:
    enum class Ramp { None, In, Out };

    float gainAt(int rampFrame) const;

    SampleBuffer buffer_{};
    int cursor_ = 0;
    int loopFade_ = 0;
    Ramp ramp_ = Ramp::None;
    int rampFrame_ = 0;
    int rampLength_ = 1;
    bool active_ = false;
};

} // namespace bt
