#pragma once

#include "SampleBuffer.h"

namespace bt {

// Where a track is read from. Randomize does not touch these.
// start is a fraction of the file, 0..1, from the first sample to the end.
// length 0 keeps one slice. length 1 uses every slice after start.
// volume is 0..1.2. pan is -1..1.
struct SampleSettings {
    double start = 0;
    double length = 1;
    bool loop = false;
    double volume = 1;
    double pan = 0;
};

// How a track is fitted to the project tempo. The values match the host's mode numbers.
enum class WarpMode { None = 0, Beat = 1, Pitch = 2 };

// The track's own tempo and how it is warped. bpm is 1..999.9. param is 0..1, and its meaning depends on the mode.
struct WarpSettings {
    WarpMode mode = WarpMode::None;
    double bpm = 120;
    double param = 0;
};

// One host-owned buffer per track, in list order.
class SampleBank {
public:
    static constexpr int kCapacity = 32;

    void append(const SampleBuffer& buffer);
    SampleBuffer remove(int index);   // shifts the later slots down
    void clear();
    void setPlay(int index, const SampleSettings& play);
    void setWarp(int index, const WarpSettings& warp);

    int count() const { return count_; }
    const SampleBuffer& at(int index) const { return buffers_[index]; }
    const SampleSettings& play(int index) const { return plays_[index]; }
    const WarpSettings& warp(int index) const { return warps_[index]; }
    const SampleSettings* findPlay(std::uint32_t id) const;

private:
    SampleBuffer buffers_[kCapacity]{};
    SampleSettings plays_[kCapacity]{};
    WarpSettings warps_[kCapacity]{};
    int count_ = 0;
};

// Volume and pan of one track, applied to one frame.
void voiceGain(const SampleSettings& play, float& left, float& right);

} // namespace bt
