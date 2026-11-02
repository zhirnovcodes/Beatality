#include "Clock.h"

#include "Curve.h"

#include <cmath>

namespace bt {

int Clock::position(const ClockSettings& settings, const SliceGrid& grid) const {
    const int loop = loopFrames(settings, grid);
    if (loop <= 0) {
        return 0;
    }
    return static_cast<int>(frame_ % loop);
}

int Clock::sliceFrames(const ClockSettings& settings, const SliceGrid& grid) const {
    return static_cast<int>(std::llround(settings.framesPerBeat() * grid.sliceBeats()));
}

int Clock::loopFrames(const ClockSettings& settings, const SliceGrid& grid) const {
    return static_cast<int>(std::llround(settings.framesPerBeat() * static_cast<double>(grid.loopBeats())));
}

int Clock::fadeFrames(const ClockSettings& settings, const SliceGrid& grid, int attackMs) const {
    const double sliceSec = grid.sliceBeats() * 60.0 / settings.bpm;
    return fadeLength(settings.sampleRate, sliceSec, attackMs * 0.001);
}

int Clock::localIn(int slot, const ClockSettings& settings, const SliceGrid& grid) const {
    const int slice = sliceFrames(settings, grid);
    const int loop = loopFrames(settings, grid);
    const int at = position(settings, grid);
    int origin = slot * slice;
    if (origin + slice <= at) {
        origin += loop;
    }
    return at - origin;
}

int Clock::sliceIndex(const ClockSettings& settings, const SliceGrid& grid) const {
    const int slice = sliceFrames(settings, grid);
    const int at = position(settings, grid);
    if (at >= grid.slotCount() * slice) {
        return -1;
    }
    return at / slice;
}

int Clock::arrivingSlot(const ClockSettings& settings, const SliceGrid& grid, int attackMs) const {
    const int slice = sliceFrames(settings, grid);
    const int loop = loopFrames(settings, grid);
    const int at = position(settings, grid);
    const int musical = grid.slotCount() * slice;
    const int fade = fadeFrames(settings, grid, attackMs);
    if (at >= musical) {
        const int until = loop - at;
        if (fade > 0 && until <= fade) {
            return 0;
        }
        return -1;
    }
    const int slot = at / slice;
    const int boundary = (slot + 1) * slice;
    const int until = boundary - at;
    const bool intoSilence = boundary >= musical && musical < loop;
    if (fade > 0 && until <= fade) {
        if (intoSilence) {
            return -1;
        }
        return boundary >= loop ? 0 : slot + 1;
    }
    return slot;
}

double Clock::seconds(const ClockSettings& settings, const SliceGrid& grid) const {
    return static_cast<double>(position(settings, grid)) / settings.sampleRate;
}

} // namespace bt
