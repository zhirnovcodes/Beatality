#include "SampleBank.h"

namespace bt {

void SampleBank::append(const SampleBuffer& buffer) {
    buffers_[count_] = buffer;
    ++count_;
}

SampleBuffer SampleBank::remove(int index) {
    const SampleBuffer removed = buffers_[index];
    for (int i = index + 1; i < count_; ++i) {
        buffers_[i - 1] = buffers_[i];
    }
    --count_;
    buffers_[count_] = {};
    return removed;
}

} // namespace bt
