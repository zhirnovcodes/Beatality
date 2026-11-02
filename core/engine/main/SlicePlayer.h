#pragma once

#include "Clock.h"
#include "Curve.h"
#include "Effects.h"
#include "EffectsBank.h"
#include "SampleBank.h"
#include "Sequence.h"

namespace bt {

// One slice voice. render writes one sample from the slice it is given.
// The effect sees that same slice and may read a nearby frame.
// Warp joins that chain later, between the effect and the curve.
class SlicePlayer {
public:
    SlicePlayer(double sampleRate, std::uint64_t seed);

    // slot is the slice index. roll is this slice's chance draw.
    // Knob changes go through setEffects and do not restart the curve.
    void setSlice(const SampleSettings& play, int slot, EffectId effect, float roll);
    // Same slice, a new window. Does not restart the curve.
    void setPlay(const SampleSettings& play);
    void setEffects(const Effects& effects);

    // One sample from the slice the engine passes in.
    void render(const SampleBuffer& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid, int attackMs,
                float& left, float& right);
    void stop();
    // The engine's transport. Moving this voice out leaves the flag on the voice that stays.
    void setRunning(bool running) { running_ = running; }
    bool running() const { return running_; }
    // Transport is on, or the curve is still above 0.
    bool isPlaying() const { return running_ || curve_.y(at_) > 0.0f; }
    bool hasStopped() const { return !(curve_.y(at_) > 0.0f); }
    // The voice must not read. The engine drops the sample reference.
    void drop();

private:
    int slicesAfter(const SampleBuffer& slice, const ClockSettings& settings, const SliceGrid& grid) const;

    EffectsBank bank_;
    Effects effects_{};
    Curve curve_{};
    SampleSettings play_{};
    int slot_ = 0;
    EffectId effect_ = EffectId::None;
    float roll_ = 1.0f;
    int at_ = 0;
    bool running_ = false;
};

} // namespace bt
