#pragma once

#include "SampleBuffer.h"

namespace bt {

// One host-owned buffer per track, in list order.
class SampleBank {
public:
    static constexpr int kCapacity = 32;

    void append(const SampleBuffer& buffer);
    SampleBuffer remove(int index);   // shifts the later slots down

    int count() const { return count_; }
    const SampleBuffer& at(int index) const { return buffers_[index]; }

private:
    SampleBuffer buffers_[kCapacity]{};
    int count_ = 0;
};

} // namespace bt
