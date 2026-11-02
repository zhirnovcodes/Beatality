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

// One host-owned buffer per track, in list order.
class SampleBank {
public:
    static constexpr int kCapacity = 32;

    void append(const SampleBuffer& buffer);
    SampleBuffer remove(int index);   // shifts the later slots down
    void clear();
    void setPlay(int index, const SampleSettings& play);

    int count() const { return count_; }
    const SampleBuffer& at(int index) const { return buffers_[index]; }
    const SampleSettings& play(int index) const { return plays_[index]; }
    const SampleSettings* findPlay(std::uint32_t id) const;

private:
    SampleBuffer buffers_[kCapacity]{};
    SampleSettings plays_[kCapacity]{};
    int count_ = 0;
};

// File frame for one local offset in a slice. maxSlices is how many slices the file holds after start.
// A frame past the file is buffer.frames, which reads as silence.
int frameAt(const SampleBuffer& buffer, const SampleSettings& play, int slot, int local, int sliceFrames, int maxSlices);

// Volume and pan of one track, applied to one frame.
void voiceGain(const SampleSettings& play, float& left, float& right);

} // namespace bt
