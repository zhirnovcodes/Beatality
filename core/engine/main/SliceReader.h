#pragma once

#include "Clock.h"
#include "SampleBank.h"

namespace bt {

// One stereo frame.
struct Frame {
    float l = 0;
    float r = 0;
};

// Reads one track's slice at a local frame on the project grid. Holds a reference to the buffer and stores nothing between reads.
// Volume and pan are applied to every frame it returns. A frame outside the file is silence.
// Source slices are measured at the sample's own BPM. The warp mode decides how one fills a project slice:
// None plays at original speed, so a long source slice is cut and a short one leaves a gap.
// Pitch stretches the source slice across the project slice, so the pitch moves with the tempo ratio.
// Beat cuts the source slice into fragments of 1/32 to 2 beats. Each one plays at original speed from its own
// place on the project grid, with a short fade at both ends, so the source slice still fills the project slice.
class SliceReader {
public:
    SliceReader(const SampleBuffer& buffer, const SampleSettings& play, const WarpSettings& warp, const ClockSettings& settings,
                const SliceGrid& grid, int slot, int sliceFrames);

    // local may be negative while the slice fades in, and may fall between two frames.
    Frame read(double local) const;

private:
    // Fragment index at offset frames into it, faded. Silence outside the fragment.
    Frame fragment(double index, double offset) const;
    // The file at a fractional frame, before volume and pan.
    Frame at(double position) const;

    const SampleBuffer& buffer_;
    const SampleSettings& play_;
    // File frame where this slot's source slice starts.
    double origin_ = 0;
    // File frames per output frame.
    double step_ = 1;
    // A local frame at or past this is silence. A short source slice has run out there.
    double end_ = 0;
    // Beat mode only. 0 in the other modes.
    // A fragment's length on the project grid, and in the file.
    double fragmentOut_ = 0;
    double fragmentSource_ = 0;
    // Length of the fade at each end of a fragment, and where its fade-out starts.
    double fade_ = 0;
    double fadeOut_ = 0;
    // The slot is past the track's slices and the track does not loop.
    bool silent_ = false;
};

} // namespace bt
