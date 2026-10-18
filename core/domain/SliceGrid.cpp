#include "SliceGrid.h"

#include <cmath>
#include <limits>
#include <stdexcept>

namespace bt {

namespace {

double beatsOf(int exponent) { return std::ldexp(1.0, exponent); }

// Shrinks a legal exponent until the slice is no longer than the loop.
int fitExp(int exponent, int loopBeats) {
    while (beatsOf(exponent) > loopBeats) {
        --exponent;
    }
    return exponent;
}

int countSlots(int loopBeats, int sliceExp) {
    if (sliceExp >= 0) {
        return loopBeats / (1 << sliceExp);
    }
    return loopBeats * (1 << -sliceExp);
}

} // namespace

SliceGrid::SliceGrid() = default;

void SliceGrid::setBpm(double bpm) {
    if (!(bpm > 0.0) || !std::isfinite(bpm)) {
        throw std::logic_error("bpm");
    }
    bpm_ = bpm;
}

void SliceGrid::setLoop(int beats) {
    if (beats < kMinLoop || beats > kMaxLoop) {
        throw std::logic_error("loop");
    }
    loopBeats_ = beats;
    sliceExp_ = fitExp(sliceExp_, loopBeats_);
}

void SliceGrid::setSlice(int exponent) {
    if (exponent < kExpMin || exponent > kExpMax) {
        throw std::logic_error("slice");
    }
    sliceExp_ = fitExp(exponent, loopBeats_);
}

double SliceGrid::bpm() const { return bpm_; }

int SliceGrid::loopBeats() const { return loopBeats_; }

int SliceGrid::sliceExp() const { return sliceExp_; }

double SliceGrid::beatSec() const { return 60.0 / bpm_; }

double SliceGrid::sliceBeats() const { return beatsOf(sliceExp_); }

double SliceGrid::sliceSec() const { return beatSec() * sliceBeats(); }

double SliceGrid::loopSec() const { return beatSec() * loopBeats_; }

double SliceGrid::remainderSec() const {
    if (sliceExp_ <= 0) {
        return 0;
    }
    return (loopBeats_ % (1 << sliceExp_)) * beatSec();
}

int SliceGrid::slotCount() const { return countSlots(loopBeats_, sliceExp_); }

PlayheadPosition SliceGrid::positionAt(double playheadBeats) const {
    if (!std::isfinite(playheadBeats) || playheadBeats < 0.0 || !(playheadBeats < loopBeats_)) {
        throw std::logic_error("playhead");
    }
    PlayheadPosition position;
    const double slice = sliceBeats();
    position.slot = static_cast<int>(std::floor(playheadBeats / slice));
    position.localBeats = playheadBeats - position.slot * slice;
    return position;
}

int SliceGrid::trackSlices(double durationSec) const {
    if (!(durationSec > 0.0) || !std::isfinite(durationSec)) {
        throw std::logic_error("duration");
    }
    const double n = std::round(durationSec / sliceSec());
    if (n < 1.0) {
        return 1;
    }
    if (n > static_cast<double>(std::numeric_limits<int>::max())) {
        throw std::logic_error("duration");
    }
    return static_cast<int>(n);
}

double SliceGrid::trackRead(double playheadBeats, int slot, double durationSec) const {
    if (slot < 0 || slot >= slotCount()) {
        throw std::logic_error("slot");
    }
    const double slice = sliceBeats();
    const double localBeats = playheadBeats - slot * slice;
    const int trackSlice = slot % trackSlices(durationSec);
    return (trackSlice * slice + localBeats) * beatSec();
}

} // namespace bt
