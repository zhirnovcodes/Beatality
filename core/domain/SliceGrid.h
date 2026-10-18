#pragma once

namespace bt {

// The slot at a playhead, and how far into that slot the playhead is.
// slot >= slotCount is the silent remainder. This is a result, not stored state.
struct PlayheadPosition {
    int slot = 0;
    double localBeats = 0;
};

// Tempo, loop size, and slice size. Lengths are derived from those three.
// The playhead, the slot, and the track list are not kept here.
class SliceGrid {
public:
    // Slice size is 2^exponent beats. -6 is 1/64, 0 is 1, 4 is 16.
    static constexpr int kExpMin = -6;
    static constexpr int kExpMax = 4;
    static constexpr int kMinLoop = 1;
    static constexpr int kMaxLoop = 32;

    // 120 BPM, 8 beats, slices of 1 beat.
    SliceGrid();

    void setBpm(double bpm);
    void setLoop(int beats);
    void setSlice(int exponent);

    double bpm() const;
    int loopBeats() const;
    int sliceExp() const;
    double beatSec() const;
    double sliceBeats() const;
    double sliceSec() const;
    double loopSec() const;
    double remainderSec() const;
    int slotCount() const;

    PlayheadPosition positionAt(double playheadBeats) const;

    // max(1, round(duration / slice)). The caller supplies the buffer's duration.
    int trackSlices(double durationSec) const;

    // playhead lined up on that track. A short track wraps. Past the file is silence.
    double trackRead(double playheadBeats, int slot, double durationSec) const;

private:
    double bpm_ = 120;
    int loopBeats_ = 8;
    int sliceExp_ = 0;
};

} // namespace bt
