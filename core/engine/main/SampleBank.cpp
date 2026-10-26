#include "SampleBank.h"

namespace bt {

void SampleBank::append(const SampleBuffer& buffer) {
    buffers_[count_] = buffer;
    plays_[count_] = {};
    ++count_;
}

SampleBuffer SampleBank::remove(int index) {
    const SampleBuffer removed = buffers_[index];
    for (int i = index + 1; i < count_; ++i) {
        buffers_[i - 1] = buffers_[i];
        plays_[i - 1] = plays_[i];
    }
    --count_;
    buffers_[count_] = {};
    plays_[count_] = {};
    return removed;
}

void SampleBank::clear() {
    for (int i = 0; i < count_; ++i) {
        buffers_[i] = {};
        plays_[i] = {};
    }
    count_ = 0;
}

void SampleBank::setPlay(int index, const TrackPlay& play) { plays_[index] = play; }

const TrackPlay* SampleBank::findPlay(std::uint32_t id) const {
    for (int i = 0; i < count_; ++i) {
        if (buffers_[i].id == id) {
            return &plays_[i];
        }
    }
    return nullptr;
}

} // namespace bt
