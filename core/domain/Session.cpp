#include "Session.h"

#include <cmath>

namespace bt {

Session::Session(std::uint64_t seed) : rng_(seed) {}

void Session::play() {
    if (count_ == 0 || index_ < 0) {
        return;
    }
    if (!playing_) {
        position_ = 0;
        playing_ = true;
    }
}

void Session::stop() {
    playing_ = false;
    position_ = 0;
}

void Session::randomize() {
    if (count_ == 0) {
        return;
    }
    index_ = rng_.nextInt(count_);
    position_ = 0;
}

bool Session::append(double durationSec) {
    if (count_ >= kMaxTracks || !(durationSec > 0.0) || !std::isfinite(durationSec)) {
        return false;
    }
    durations_[count_] = durationSec;
    ++count_;
    return true;
}

void Session::removeFirst() {
    if (count_ == 0) {
        return;
    }
    for (int i = 1; i < count_; ++i) {
        durations_[i - 1] = durations_[i];
    }
    --count_;
    if (count_ == 0) {
        index_ = -1;
        playing_ = false;
        position_ = 0;
        return;
    }
    if (index_ == 0) {
        index_ = -1;
        position_ = 0;
        return;
    }
    if (index_ > 0) {
        --index_;
    }
}

void Session::advance(double seconds) {
    if (!playing_ || index_ < 0 || !(seconds > 0.0)) {
        return;
    }
    const double dur = durations_[index_];
    if (!(dur > 0.0)) {
        return;
    }
    position_ = std::fmod(position_ + seconds, dur);
    if (position_ < 0.0) {
        position_ += dur;
    }
}

int Session::count() const { return count_; }

int Session::index() const { return index_; }

bool Session::playing() const { return playing_; }

double Session::position() const { return position_; }

double Session::duration() const {
    if (index_ < 0 || index_ >= count_) {
        return 0;
    }
    return durations_[index_];
}

double Session::trackDuration(int trackIndex) const {
    if (trackIndex < 0 || trackIndex >= count_) {
        return 0;
    }
    return durations_[trackIndex];
}

} // namespace bt
