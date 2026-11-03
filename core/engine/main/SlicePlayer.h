#pragma once

#include "Clock.h"
#include "Curve.h"
#include "Effects.h"
#include "EffectsBank.h"
#include "SampleBank.h"
#include "Sequence.h"

namespace bt {

// One slice voice. render writes one sample from the slice it is given.
// The slice is read through a SliceReader. The effect gets that reader and returns the sample.
class SlicePlayer {
public:
    SlicePlayer(double sampleRate, std::uint64_t seed);

    // slot is the slice index. roll is this slice's chance draw. panRoll is its pan draw, -1..1.
    // Knob changes go through setEffects and setPanRange and do not restart the curve.
    void setSlice(const SampleSettings& play, const WarpSettings& warp, int slot, EffectId effect, float roll, float panRoll);
    // Same slice, a new window or warp. Does not restart the curve.
    void setPlay(const SampleSettings& play, const WarpSettings& warp);
    void setEffects(const Effects& effects);
    // The pan roll is scaled from -1..1 onto min..max. Both are -1..1.
    void setPanRange(double min, double max);

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
    EffectsBank bank_;
    Effects effects_{};
    Curve curve_{};
    SampleSettings play_{};
    WarpSettings warp_{};
    int slot_ = 0;
    EffectId effect_ = EffectId::None;
    float roll_ = 1.0f;
    float panRoll_ = 0.0f;
    double panMin_ = 0;
    double panMax_ = 0;
    int at_ = 0;
    bool running_ = false;
};

} // namespace bt
