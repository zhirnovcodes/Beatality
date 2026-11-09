#pragma once

#include "BeatRepeatSettings.h"
#include "Clock.h"
#include "Curve.h"
#include "Interpolator.h"
#include "RepeatSequence.h"
#include "SliceReader.h"

#include <memory>

namespace bt {

// Beat repeat on the mixed voices, after the slice effects.
// A position fires when the clock lands on its start. The next size beats are recorded while they
// play, then the recording plays again for length beats, the tail. The size is picked by that
// position's size roll. The tail ends at its length, at the loop end, at the next firing, or when
// the effect is turned off.
// Each join crossfades over attackFrames(size): the end of one copy into the next copy, and the
// last copy back into the dry frames. The recording keeps that many frames past size for those fades.
// The buffer holds 4 seconds plus the longest fade, which is 2 beats at 30 BPM. Allocated with the engine.
class BeatRepeat {
public:
    explicit BeatRepeat(double sampleRate);

    Frame render(Frame in, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid, const BeatRepeatSettings& repeat,
                 const RepeatSequence& rolls);
    void clean();

private:
    // Ends the repeat. The copy that was playing fades out over its fade.
    void release();
    void fadeFrom(int index);

    // Owned here so moving the engine keeps the same recording.
    std::unique_ptr<float[]> left_;
    std::unique_ptr<float[]> right_;
    int capacity_ = 0;
    // Loop frame of the previous call. A smaller one is the loop end.
    int lastPosition_ = -1;
    bool active_ = false;
    // Frames since the position fired.
    int elapsed_ = 0;
    int length_ = 1;
    int tail_ = 0;
    int attack_ = 1;
    // The sound being faded out, read from the recording. The curve is the sound coming in.
    bool fading_ = false;
    int fadeFrom_ = 0;
    int fadeElapsed_ = 0;
    int fadeLength_ = 1;
    Curve fade_{};
    // The mix moves to a new value over Interpolator::kChangeSec.
    Interpolator mix_{1.0f};
};

} // namespace bt
