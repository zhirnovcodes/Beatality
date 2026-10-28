#pragma once

#include "SampleBuffer.h"

namespace bt {

// Where a track is read from. Randomize does not touch these.
// start is a fraction of the file, 0..1, from the first sample to the end.
// length 0 keeps one slice. length 1 uses every slice after start.
// volume is 0..1.2. pan is -1..1.
struct TrackPlay {
    double start = 0;
    double length = 1;
    bool loop = false;
    double volume = 1;
    double pan = 0;
};

// One host-owned buffer per track, in list order.
class SampleBank {
public:
    static constexpr int kCapacity = 32;

    void append(const SampleBuffer& buffer);
    SampleBuffer remove(int index);   // shifts the later slots down
    void clear();
    void setPlay(int index, const TrackPlay& play);

    int count() const { return count_; }
    const SampleBuffer& at(int index) const { return buffers_[index]; }
    const TrackPlay& play(int index) const { return plays_[index]; }
    const TrackPlay* findPlay(std::uint32_t id) const;

private:
    SampleBuffer buffers_[kCapacity]{};
    TrackPlay plays_[kCapacity]{};
    int count_ = 0;
};

} // namespace bt
