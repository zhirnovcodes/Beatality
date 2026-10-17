#pragma once

#include "SampleBuffer.h"
#include "Session.h"

namespace bt {

// Audio for each track, in the same order as the Session's track list.
class SampleBank {
public:
    static constexpr int kCapacity = Session::kMaxTracks;

    bool append(const SampleBuffer& buffer);   // false when full or invalid

    // Removes index 0 and shifts the rest down. Returns the removed buffer,
    // or an invalid one when the bank is empty.
    SampleBuffer removeFirst();

    int count() const { return count_; }
    const SampleBuffer& at(int index) const { return buffers_[index]; }

private:
    SampleBuffer buffers_[kCapacity]{};
    int count_ = 0;
};

} // namespace bt
