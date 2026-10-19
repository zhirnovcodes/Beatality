#include "SampleBank.h"

namespace bt {

bool SampleBank::append(const SampleBuffer& buffer) {
    if (count_ >= kCapacity || !buffer.valid()) {
        return false;
    }
    buffers_[count_] = buffer;
    ++count_;
    return true;
}

SampleBuffer SampleBank::removeFirst() {
    if (count_ == 0) {
        return {};
    }
    const SampleBuffer removed = buffers_[0];
    for (int i = 1; i < count_; ++i) {
        buffers_[i - 1] = buffers_[i];
    }
    --count_;
    buffers_[count_] = {};
    return removed;
}

} // namespace bt
