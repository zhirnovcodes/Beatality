#include "SampleBank.h"

namespace bt {

namespace {

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
    warps_[count_] = {};
    ++count_;
}

SampleBuffer SampleBank::remove(int index) {
    const SampleBuffer removed = buffers_[index];
    for (int i = index + 1; i < count_; ++i) {
        buffers_[i - 1] = buffers_[i];
        plays_[i - 1] = plays_[i];
        warps_[i - 1] = warps_[i];
    }
    --count_;
    buffers_[count_] = {};
    plays_[count_] = {};
    warps_[count_] = {};
    return removed;
}

void SampleBank::clear() {
    for (int i = 0; i < count_; ++i) {
        buffers_[i] = {};
        plays_[i] = {};
        warps_[i] = {};
    }
    count_ = 0;
}

void SampleBank::setPlay(int index, const SampleSettings& play) { plays_[index] = play; }

void SampleBank::setWarp(int index, const WarpSettings& warp) { warps_[index] = warp; }

const SampleSettings* SampleBank::findPlay(std::uint32_t id) const {
    for (int i = 0; i < count_; ++i) {
        if (buffers_[i].id == id) {
            return &plays_[i];
        }
    }
    return nullptr;
}

void voiceGain(const SampleSettings& play, float& left, float& right) {
    const float volume = static_cast<float>(clamp(play.volume, 0.0, 1.2));
    const double pan = clamp(play.pan, -1.0, 1.0);
    const float leftGain = static_cast<float>(pan <= 0.0 ? 1.0 : 1.0 - pan);
    const float rightGain = static_cast<float>(pan >= 0.0 ? 1.0 : 1.0 + pan);
    left *= volume * leftGain;
    right *= volume * rightGain;
}

} // namespace bt
