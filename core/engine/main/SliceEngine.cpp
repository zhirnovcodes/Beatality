#include "SliceEngine.h"

#include <cmath>

namespace bt {

SliceEngine::SliceEngine(double sampleRate, std::uint64_t seed)
    : sampleRate_(sampleRate), rng_(seed) {
    listen();
}

void SliceEngine::play() {
    if (sequence_.empty()) {
        sequence_.generate(grid_.slotCount(), bank_.count(), rng_);
    }
    listen();
    if (playing_ || play_.fadingOut()) {
        const int at = heard();
        const int slice = sliceFrames();
        if (at < grid_.slotCount() * slice) {
            handoff(bufferForSlot(at / slice));
        } else {
            handoff({});
        }
    } else {
        playAt_ = clock_;
        playing_ = true;
    }
    position_ = 0;
}

void SliceEngine::stop() {
    if (playing_) {
        fadePosition_ = position_;
        if (!play_.fadingOut()) {
            play_.stop(clock_ - playAt_);
        }
    }
    playing_ = false;
    position_ = 0;
}

void SliceEngine::randomize() {
    SampleBuffer from{};
    const bool live = playing_ || play_.fadingOut();
    if (live) {
        from = bufferForSlot(position_ / sliceFrames());
    }
    sequence_.generate(grid_.slotCount(), bank_.count(), rng_);
    if (live) {
        handoff(from);
    }
}

void SliceEngine::append(const SampleBuffer& buffer) {
    SampleBuffer from{};
    const bool live = playing_ && !sequence_.empty();
    if (live) {
        from = bufferForSlot(position_ / sliceFrames());
    }
    bank_.append(buffer);
    if (live) {
        handoff(from);
    }
}

void SliceEngine::setTrack(int index, double start, double length, bool loop) {
    if (index < 0 || index >= bank_.count()) {
        return;
    }
    if (start < 0.0) {
        start = 0.0;
    } else if (start > 1.0) {
        start = 1.0;
    }
    if (length < 0.0) {
        length = 0.0;
    } else if (length > 1.0) {
        length = 1.0;
    }
    bank_.setPlay(index, TrackPlay{start, length, loop});
}

void SliceEngine::remove(int index) {
    SampleBuffer from{};
    const bool live = (playing_ || play_.fadingOut()) && !sequence_.empty();
    if (live) {
        from = bufferForSlot(position_ / sliceFrames());
        remember(from);
    }
    const std::uint32_t id = bank_.remove(index).id;
    if (bank_.count() == 0 && !sequence_.empty()) {
        sequence_.clear();
    }
    if (!live) {
        released_[releasedCount_++] = id;
        return;
    }
    if (from.id == id) {
        if (pendingHeld_) {
            released_[releasedCount_++] = pending_;
        }
        pending_ = id;
        pendingHeld_ = true;
    } else {
        released_[releasedCount_++] = id;
    }
    if (bank_.count() == 0) {
        if (!play_.fadingOut()) {
            play_.stop(clock_ - playAt_);
        }
        outgoingPosition_ = heard();
        outgoing_ = play_;
        outgoingAt_ = playAt_;
        outgoingBuffer_ = from;
        playing_ = false;
        position_ = 0;
        return;
    }
    handoff(from);
}

void SliceEngine::setBpm(double bpm) {
    const double beats = static_cast<double>(position_) / framesPerBeat();
    grid_.setBpm(bpm);
    place(beats);
    listen();
}

void SliceEngine::setLoop(int beats) {
    const int oldExp = grid_.sliceExp();
    const int oldSlots = grid_.slotCount();
    const double at = static_cast<double>(position_) / framesPerBeat();
    SampleBuffer from{};
    const bool live = playing_ && !sequence_.empty();
    if (live) {
        from = bufferForSlot(position_ / sliceFrames());
    }
    grid_.setLoop(beats);
    if (at >= grid_.loopBeats()) {
        place(at);
    }
    syncSequence(oldExp, oldSlots);
    listen();
    if (live) {
        handoff(from);
    }
}

void SliceEngine::setSlice(int exponent) {
    const int oldExp = grid_.sliceExp();
    const int oldSlots = grid_.slotCount();
    SampleBuffer from{};
    const bool live = playing_ && !sequence_.empty();
    if (live) {
        from = bufferForSlot(position_ / sliceFrames());
    }
    grid_.setSlice(exponent);
    syncSequence(oldExp, oldSlots);
    listen();
    if (live) {
        handoff(from);
    }
}

void SliceEngine::setAttack(int ms) {
    attackMs_ = ms;
    listen();
}

void SliceEngine::render(float* left, float* right, int frames) {
    for (int i = 0; i < frames; ++i) {
        float sampleL = 0.0f;
        float sampleR = 0.0f;
        mixSlice(sampleL, sampleR);
        applyPlay(sampleL, sampleR);
        mixOutgoing(sampleL, sampleR);
        left[i] = sampleL;
        right[i] = sampleR;
        advance();
    }
}

void SliceEngine::mixSlice(float& left, float& right) const {
    left = 0.0f;
    right = 0.0f;
    if (sequence_.empty() || bank_.count() == 0) {
        return;
    }

    const int slice = sliceFrames();
    const int loop = loopFrames();
    const int musical = grid_.slotCount() * slice;
    const int fade = fadeFrames();
    const int position = heard();
    float nowL = 0.0f;
    float nowR = 0.0f;
    float prevL = 0.0f;
    float prevR = 0.0f;
    float sliceG = 1.0f;

    if (position >= musical) {
        const int until = loop - position;
        if (fade > 0 && until <= fade) {
            sliceG = slice_.y(fade - until);
            const SampleBuffer& next = bufferForSlot(0);
            take(next, frameIn(next, bank_.play(sequence_.indexAt(0, bank_.count())), 0, position), nowL, nowR);
        }
    } else {
        const int slot = position / slice;
        const int boundary = (slot + 1) * slice;
        const int until = boundary - position;
        const bool intoSilence = boundary >= musical && musical < loop;
        if (fade > 0 && until <= fade) {
            sliceG = slice_.y(fade - until);
            if (!intoSilence) {
                const int nextSlot = boundary >= loop ? 0 : slot + 1;
                const SampleBuffer& next = bufferForSlot(nextSlot);
                take(next, frameIn(next, bank_.play(sequence_.indexAt(nextSlot, bank_.count())), nextSlot, position), nowL, nowR);
            }
            const SampleBuffer& prev = bufferForSlot(slot);
            take(prev, frameIn(prev, bank_.play(sequence_.indexAt(slot, bank_.count())), slot, position), prevL, prevR);
        } else {
            const SampleBuffer& current = bufferForSlot(slot);
            take(current, frameIn(current, bank_.play(sequence_.indexAt(slot, bank_.count())), slot, position), nowL, nowR);
        }
    }

    left = sliceG * nowL + (1.0f - sliceG) * prevL;
    right = sliceG * nowR + (1.0f - sliceG) * prevR;
}

void SliceEngine::applyPlay(float& left, float& right) const {
    const float playG = (playing_ || play_.fadingOut()) ? play_.y(clock_ - playAt_) : 0.0f;
    left *= playG;
    right *= playG;
}

void SliceEngine::mixOutgoing(float& left, float& right) {
    if (!outgoing_.fadingOut()) {
        return;
    }
    const int slice = sliceFrames();
    const int musical = grid_.slotCount() * slice;
    const float oldG = outgoing_.y(clock_ - outgoingAt_);
    float oldL = 0.0f;
    float oldR = 0.0f;
    const int slot = outgoingPosition_ < musical ? outgoingPosition_ / slice : 0;
    take(outgoingBuffer_, frameIn(outgoingBuffer_, outgoingPlay_, slot, outgoingPosition_), oldL, oldR);
    left += oldG * oldL;
    right += oldG * oldR;
    if (oldG == 0.0f && pendingHeld_) {
        released_[releasedCount_++] = pending_;
        pendingHeld_ = false;
    }
}

void SliceEngine::advance() {
    const bool stopping = !playing_ && play_.fadingOut();
    const bool tail = outgoing_.fadingOut();
    if (playing_ || stopping || tail) {
        ++clock_;
    }
    if (playing_) {
        ++position_;
        if (position_ >= loopFrames()) {
            position_ = 0;
        }
    }
    if (stopping) {
        ++fadePosition_;
        if (fadePosition_ >= loopFrames()) {
            fadePosition_ = 0;
        }
    }
    if (tail) {
        ++outgoingPosition_;
        if (outgoingPosition_ >= loopFrames()) {
            outgoingPosition_ = 0;
        }
        if (outgoing_.y(clock_ - outgoingAt_) == 0.0f) {
            outgoing_ = Curve();
            outgoing_.setLength(fadeFrames());
        }
    }
    if (stopping && play_.y(clock_ - playAt_) == 0.0f) {
        play_ = Curve();
        play_.setLength(fadeFrames());
        position_ = 0;
    }
}

int SliceEngine::heard() const {
    if (!playing_ && play_.fadingOut()) {
        return fadePosition_;
    }
    return position_;
}

void SliceEngine::fillSnapshot(SliceSnapshot& out) {
    out.count = bank_.count();
    out.playing = playing_;
    out.sliceExp = grid_.sliceExp();
    out.loopBeats = grid_.loopBeats();
    out.bpm = grid_.bpm();
    out.playSlot = -1;
    out.playTrack = -1;
    const int slice = sliceFrames();
    const int musical = grid_.slotCount() * slice;
    if (playing_ && slice > 0 && position_ < musical && bank_.count() > 0 && !sequence_.empty()) {
        out.playSlot = position_ / slice;
        out.playTrack = sequence_.indexAt(out.playSlot, bank_.count());
    }
    out.releasedCount = releasedCount_;
    for (int i = 0; i < releasedCount_; ++i) {
        out.released[i] = released_[i];
    }
    releasedCount_ = 0;
}

void SliceEngine::handoff(const SampleBuffer& from) {
    remember(from);
    outgoingPosition_ = heard();
    if (!play_.fadingOut()) {
        play_.stop(clock_ - playAt_);
    }
    outgoing_ = play_;
    outgoingAt_ = playAt_;
    outgoingBuffer_ = from;
    play_ = Curve();
    play_.setLength(fadeFrames());
    playAt_ = clock_;
    playing_ = true;
}

void SliceEngine::syncSequence(int oldExp, int oldSlots) {
    if (sequence_.empty()) {
        return;
    }
    const int exp = grid_.sliceExp();
    const int slots = grid_.slotCount();
    if (exp != oldExp) {
        sequence_.generate(slots, bank_.count(), rng_);
    } else if (slots > oldSlots) {
        sequence_.append(slots, rng_);
    } else if (slots < oldSlots) {
        sequence_.crop(slots);
    }
}

void SliceEngine::place(double beats) {
    const double wrapped = std::fmod(beats, grid_.loopBeats());
    position_ = static_cast<int>(std::llround(wrapped * framesPerBeat()));
}

void SliceEngine::listen() {
    const int n = fadeFrames();
    slice_.setLength(n);
    if (!play_.fadingOut()) {
        play_.setLength(n);
    }
}

const SampleBuffer& SliceEngine::bufferForSlot(int slot) const {
    return bank_.at(sequence_.indexAt(slot, bank_.count()));
}

void SliceEngine::remember(const SampleBuffer& buffer) {
    if (const TrackPlay* found = bank_.findPlay(buffer.id)) {
        outgoingPlay_ = *found;
    }
}

int SliceEngine::frameIn(const SampleBuffer& buffer, const TrackPlay& play, int slot, int position) const {
    const int slice = sliceFrames();
    const int loop = loopFrames();
    int origin = slot * slice;
    if (origin + slice <= position) {
        origin += loop;
    }
    const int local = position - origin;
    const double durationSec = static_cast<double>(buffer.frames) / sampleRate_;
    const double start = play.start < 0.0 ? 0.0 : (play.start > 1.0 ? 1.0 : play.start);
    const double length = play.length < 0.0 ? 0.0 : (play.length > 1.0 ? 1.0 : play.length);
    const int maxSlices = grid_.trackSlices(durationSec * (1.0 - start));
    const int sliceCount = static_cast<int>(std::llround(length * (maxSlices - 1))) + 1;
    if (!play.loop && slot >= sliceCount) {
        return buffer.frames;
    }
    const int trackSlice = slot % sliceCount;
    const int startFrame = static_cast<int>(std::llround(start * buffer.frames));
    return startFrame + trackSlice * slice + local;
}

void SliceEngine::take(const SampleBuffer& buffer, int frame, float& left, float& right) const {
    if (frame < 0 || frame >= buffer.frames) {
        left = 0.0f;
        right = 0.0f;
        return;
    }
    left = buffer.left[frame];
    right = buffer.right[frame];
}

int SliceEngine::fadeFrames() const {
    return fadeLength(sampleRate_, grid_.sliceSec(), attackMs_ * 0.001);
}

int SliceEngine::sliceFrames() const {
    return static_cast<int>(std::llround(grid_.sliceSec() * sampleRate_));
}

int SliceEngine::loopFrames() const {
    return static_cast<int>(std::llround(grid_.loopSec() * sampleRate_));
}

double SliceEngine::framesPerBeat() const { return sampleRate_ * grid_.beatSec(); }

} // namespace bt
