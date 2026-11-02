#pragma once

#include "SliceGrid.h"

#include <cstdint>

namespace bt {

// Sample rate and tempo. Everything else is calculated from these and the frame.
struct ClockSettings {
    double sampleRate = 44100;
    double bpm = 120;

    double framesPerBeat() const { return sampleRate * 60.0 / bpm; }
};

// One voice's sample index. It only grows. The loop position is calculated from it.
// A handoff copies this index onto the voice that is leaving.
class Clock {
public:
    void seek(std::int64_t frame) { frame_ = frame; }
    void tick() { ++frame_; }

    std::int64_t frame() const { return frame_; }

    int sliceFrames(const ClockSettings& settings, const SliceGrid& grid) const;
    int loopFrames(const ClockSettings& settings, const SliceGrid& grid) const;
    int fadeFrames(const ClockSettings& settings, const SliceGrid& grid, int attackMs) const;
    // Frame inside that slice. Negative while the next slice is fading in.
    int localIn(int slot, const ClockSettings& settings, const SliceGrid& grid) const;
    // Slice under this frame, or -1 in the silent remainder.
    int sliceIndex(const ClockSettings& settings, const SliceGrid& grid) const;
    // Slice that should be sounding. Within a fade of a boundary, the next slice.
    // The remainder is silence. The fade at the loop end wraps to slice 0.
    int arrivingSlot(const ClockSettings& settings, const SliceGrid& grid, int attackMs) const;
    // Playhead inside the loop, in seconds.
    double seconds(const ClockSettings& settings, const SliceGrid& grid) const;

private:
    int position(const ClockSettings& settings, const SliceGrid& grid) const;

    std::int64_t frame_ = 0;
};

} // namespace bt
