#include "SampleBank.h"

#include <cmath>

namespace bt {

namespace {

double unit(double value) {
    if (value < 0.0) {
        return 0.0;
    }
    if (value > 1.0) {
        return 1.0;
    }
    return value;
}

double clamp(double value, double low, double high) {
    if (value < low) {
        return low;
    }
    if (value > high) {
        return high;
    }
    return value;
}

} // namespace

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

int frameAt(const SampleBuffer& buffer, const TrackPlay& play, int slot, int local, int sliceFrames, int maxSlices) {
    const double start = unit(play.start);
    const double length = unit(play.length);
    const int sliceCount = static_cast<int>(std::llround(length * (maxSlices - 1))) + 1;
    if (!play.loop && slot >= sliceCount) {
        return buffer.frames;
    }
    const int trackSlice = slot % sliceCount;
    const int startFrame = static_cast<int>(std::llround(start * buffer.frames));
    return startFrame + trackSlice * sliceFrames + local;
}

void voiceGain(const TrackPlay& play, float& left, float& right) {
    const float volume = static_cast<float>(clamp(play.volume, 0.0, 1.2));
    const double pan = clamp(play.pan, -1.0, 1.0);
    const float leftGain = static_cast<float>(pan <= 0.0 ? 1.0 : 1.0 - pan);
    const float rightGain = static_cast<float>(pan >= 0.0 ? 1.0 : 1.0 + pan);
    left *= volume * leftGain;
    right *= volume * rightGain;
}

} // namespace bt
