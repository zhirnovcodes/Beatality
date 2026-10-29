#include "SliceEngine.h"

#include <cmath>
#include <utility>

namespace bt {

SliceEngine::SliceEngine(double sampleRate, std::uint64_t seed)
    : sampleRate_(sampleRate), currentBank_(sampleRate, seed), decayingBank_(sampleRate, seed + 1), rng_(seed) {
    listen();
}

void SliceEngine::play() {
    if (sequence_.empty()) {
        sequence_.generate(grid_.slotCount(), bank_.count(), rng_, reverbChance_, delayChance_, reverseChance_, filterChance_, flangerChance_, tranceChance_, shiftChance_);
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
    cleanBanks();
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
    cleanBanks();
    SampleBuffer from{};
    const bool live = playing_ || play_.fadingOut();
    if (live) {
        from = bufferForSlot(position_ / sliceFrames());
    }
    sequence_.generate(grid_.slotCount(), bank_.count(), rng_, reverbChance_, delayChance_, reverseChance_, filterChance_, flangerChance_, tranceChance_, shiftChance_);
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

void SliceEngine::setTrack(int index, double start, double length, bool loop) {
    if (index < 0 || index >= bank_.count()) {
        return;
    }
    TrackPlay play = bank_.play(index);
    play.start = unit(start);
    play.length = unit(length);
    play.loop = loop;
    bank_.setPlay(index, play);
}

void SliceEngine::installSequence(const std::uint16_t* slots, int size, int savedCount) {
    sequence_.assign(slots, size, savedCount);
}

void SliceEngine::setIndexedTrack(int index, double start, double length, bool loop, double volume, double pan) {
    if (index < 0 || index >= bank_.count()) {
        return;
    }
    bank_.setPlay(index, TrackPlay{
                             .start = unit(start),
                             .length = unit(length),
                             .loop = loop,
                             .volume = clamp(volume, 0.0, 1.2),
                             .pan = clamp(pan, -1.0, 1.0),
                         });
}

void SliceEngine::remove(int index) {
    cleanBanks();
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

void SliceEngine::clear() {
    cleanBanks();
    SampleBuffer from{};
    const bool live = (playing_ || play_.fadingOut()) && !sequence_.empty() && bank_.count() > 0;
    if (live) {
        const int slice = sliceFrames();
        const int at = heard();
        if (slice > 0 && at < grid_.slotCount() * slice) {
            from = bufferForSlot(at / slice);
            remember(from);
        }
    }

    const bool keep = from.valid();
    for (int i = 0; i < bank_.count(); ++i) {
        const std::uint32_t id = bank_.at(i).id;
        if (keep && id == from.id) {
            continue;
        }
        released_[releasedCount_++] = id;
    }
    bank_.clear();
    sequence_.clear();

    if (keep) {
        if (pendingHeld_ && pending_ != from.id) {
            released_[releasedCount_++] = pending_;
        }
        pending_ = from.id;
        pendingHeld_ = true;
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

    if (playing_) {
        stop();
    }
    if (pendingHeld_ && !outgoing_.fadingOut()) {
        released_[releasedCount_++] = pending_;
        pendingHeld_ = false;
    }
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

void SliceEngine::setGlobalPower(double power) { globalPower_ = power; }

void SliceEngine::setGlobalBeat(int exponent) { globalBeat_ = std::ldexp(1.0, exponent); }

void SliceEngine::setGlobalChance(double chance) { globalChance_ = chance; }

void SliceEngine::setReverbPower(double power) { reverbPower_ = power; }

void SliceEngine::setReverbChance(double chance) { reverbChance_ = chance; }

void SliceEngine::setDelayPower(double power) { delayPower_ = power; }

void SliceEngine::setDelayChance(double chance) { delayChance_ = chance; }

void SliceEngine::setReversePower(double power) { reversePower_ = power; }

void SliceEngine::setReverseChance(double chance) { reverseChance_ = chance; }

void SliceEngine::setFilterPower(double power) { filterPower_ = power; }

void SliceEngine::setFilterChance(double chance) { filterChance_ = chance; }

void SliceEngine::setFlangerPower(double power) { flangerPower_ = power; }

void SliceEngine::setFlangerChance(double chance) { flangerChance_ = chance; }

void SliceEngine::setTrancePower(double power) { trancePower_ = power; }

void SliceEngine::setTranceChance(double chance) { tranceChance_ = chance; }

void SliceEngine::setShiftPower(double power) { shiftPower_ = power; }

void SliceEngine::setShiftChance(double chance) { shiftChance_ = chance; }

void SliceEngine::setOutput(double volume, double pan) {
    volume_ = clamp(volume, 0.0, 1.2);
    pan_ = clamp(pan, -1.0, 1.0);
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
    const float volume = static_cast<float>(volume_);
    const float leftGain = static_cast<float>(pan_ <= 0.0 ? 1.0 : 1.0 - pan_) * volume;
    const float rightGain = static_cast<float>(pan_ >= 0.0 ? 1.0 : 1.0 + pan_) * volume;
    if (leftGain == 1.0f && rightGain == 1.0f) {
        return;
    }
    for (int i = 0; i < frames; ++i) {
        left[i] *= leftGain;
        right[i] *= rightGain;
    }
}

void SliceEngine::mixSlice(float& left, float& right) {
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
    int nowSlot = -1;
    int prevSlot = -1;

    if (position >= musical) {
        const int until = loop - position;
        if (fade > 0 && until <= fade) {
            sliceG = slice_.y(fade - until);
            nowSlot = 0;
            const int track = sequence_.indexAt(0, bank_.count());
            hear(bufferForSlot(0), bank_.play(track), 0, position, nowL, nowR);
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
                const int nextTrack = sequence_.indexAt(nextSlot, bank_.count());
                nowSlot = nextSlot;
                hear(bufferForSlot(nextSlot), bank_.play(nextTrack), nextSlot, position, nowL, nowR);
            }
            const int track = sequence_.indexAt(slot, bank_.count());
            prevSlot = slot;
            hear(bufferForSlot(slot), bank_.play(track), slot, position, prevL, prevR);
        } else {
            const int track = sequence_.indexAt(slot, bank_.count());
            nowSlot = slot;
            hear(bufferForSlot(slot), bank_.play(track), slot, position, nowL, nowR);
        }
    }

    // The slot that is ending keeps the bank it already filled. The slot that is
    // starting takes the other one. When the fade ends, that leftover tail is dropped.
    const bool inFade = prevSlot >= 0 || (nowSlot >= 0 && position >= musical);
    if (inFade) {
        if (!fading_) {
            std::swap(currentBank_, decayingBank_);
            fading_ = true;
        }
    } else if (fading_) {
        decayingBank_.clean();
        fading_ = false;
    }

    if (nowSlot >= 0) {
        affect(currentBank_, nowSlot, position, nowL, nowR);
    }
    if (prevSlot >= 0) {
        affect(decayingBank_, prevSlot, position, prevL, prevR);
    }

    left = sliceG * nowL + (1.0f - sliceG) * prevL;
    right = sliceG * nowR + (1.0f - sliceG) * prevR;
}

void SliceEngine::affect(EffectsBank& bank, int slot, int position, float& left, float& right) {
    const EffectId effect = sequence_.effectAt(slot);
    if (!(sequence_.rollAt(slot) < globalChance_) || effect == EffectId::None) {
        bank.clean();
        return;
    }
    bank.bind(slot);
    float revL = left;
    float revR = right;
    if (effect == EffectId::Reverse) {
        const int track = sequence_.indexAt(slot, bank_.count());
        readReversed(bufferForSlot(slot), bank_.play(track), slot, position, revL, revR);
    }
    double localPower = reversePower_;
    if (effect == EffectId::Reverb) {
        localPower = reverbPower_;
    } else if (effect == EffectId::Delay) {
        localPower = delayPower_;
    } else if (effect == EffectId::Filter) {
        localPower = filterPower_;
    } else if (effect == EffectId::Flanger) {
        localPower = flangerPower_;
    } else if (effect == EffectId::Trance) {
        localPower = trancePower_;
    } else if (effect == EffectId::Shift) {
        localPower = shiftPower_;
    }
    const float wet = static_cast<float>(unit(localPower * globalPower_));
    float outL = 0.0f;
    float outR = 0.0f;
    bank.apply(effect, left, right, revL, revR, offsetInSlice(slot, position), wet, globalBeat_, sampleRate_, grid_.bpm(), outL, outR);
    left = outL;
    right = outR;
}

int SliceEngine::offsetInSlice(int slot, int position) const {
    const int slice = sliceFrames();
    const int loop = loopFrames();
    int origin = slot * slice;
    if (origin + slice <= position) {
        origin += loop;
    }
    return position - origin;
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
    hear(outgoingBuffer_, outgoingPlay_, slot, outgoingPosition_, oldL, oldR);
    left += oldG * oldL;
    right += oldG * oldR;
    if (oldG == 0.0f && pendingHeld_) {
        released_[releasedCount_++] = pending_;
        pendingHeld_ = false;
    }
}

void SliceEngine::cleanBanks() {
    currentBank_.clean();
    decayingBank_.clean();
    fading_ = false;
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
            // The clock already moved, so the mix read the previous sample and
            // will not see this zero itself.
            if (pendingHeld_) {
                released_[releasedCount_++] = pending_;
                pendingHeld_ = false;
            }
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
    const int loop = loopFrames();
    out.playhead = playing_ && loop > 0 ? static_cast<double>(position_) / static_cast<double>(loop) : 0.0;
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
        sequence_.generate(slots, bank_.count(), rng_, reverbChance_, delayChance_, reverseChance_, filterChance_, flangerChance_, tranceChance_, shiftChance_);
    } else if (slots > oldSlots) {
        sequence_.append(slots, rng_, reverbChance_, delayChance_, reverseChance_, filterChance_, flangerChance_, tranceChance_, shiftChance_);
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

int SliceEngine::frameAt(const SampleBuffer& buffer, const TrackPlay& play, int slot, int local) const {
    const int slice = sliceFrames();
    const double durationSec = static_cast<double>(buffer.frames) / sampleRate_;
    const double start = unit(play.start);
    const double length = unit(play.length);
    const int maxSlices = grid_.trackSlices(durationSec * (1.0 - start));
    const int sliceCount = static_cast<int>(std::llround(length * (maxSlices - 1))) + 1;
    if (!play.loop && slot >= sliceCount) {
        return buffer.frames;
    }
    const int trackSlice = slot % sliceCount;
    const int startFrame = static_cast<int>(std::llround(start * buffer.frames));
    return startFrame + trackSlice * slice + local;
}

int SliceEngine::frameIn(const SampleBuffer& buffer, const TrackPlay& play, int slot, int position) const {
    const int slice = sliceFrames();
    const int loop = loopFrames();
    int origin = slot * slice;
    if (origin + slice <= position) {
        origin += loop;
    }
    return frameAt(buffer, play, slot, position - origin);
}

namespace {

void voiceGain(const TrackPlay& play, float& left, float& right) {
    const float volume = static_cast<float>(clamp(play.volume, 0.0, 1.2));
    const double pan = clamp(play.pan, -1.0, 1.0);
    const float leftGain = static_cast<float>(pan <= 0.0 ? 1.0 : 1.0 - pan);
    const float rightGain = static_cast<float>(pan >= 0.0 ? 1.0 : 1.0 + pan);
    left *= volume * leftGain;
    right *= volume * rightGain;
}

struct PartRead {
    int mirrored = 0;
    int offset = 0;
    int length = 0;
};

// Each part plays from its end back to its start. Frames before the slice
// continue that reverse past the first part, so the fade into the slice is the same line.
PartRead partRead(int local, int sliceFrames, int partFrames, int parts) {
    if (local < 0) {
        const int end = partFrames < sliceFrames ? partFrames : sliceFrames;
        return {end - 1 - local, local, end};
    }
    int index = local / partFrames;
    if (index >= parts) {
        index = parts - 1;
    }
    const int start = index * partFrames;
    const int end = index + 1 >= parts ? sliceFrames : start + partFrames;
    return {end - 1 - (local - start), local - start, end - start};
}

// The reversed copy rises from dry over the attack, holds, then falls back to dry.
// The same length closes the part, so the joins stay on the dry frame.
float copyEnvelope(int offset, int length, int attack) {
    if (offset < 0 || length <= 0 || attack <= 0) {
        return 0.0f;
    }
    float rise = static_cast<float>(offset) / static_cast<float>(attack);
    if (rise > 1.0f) {
        rise = 1.0f;
    }
    float fall = 1.0f;
    if (offset >= length - attack) {
        fall = static_cast<float>(length - 1 - offset) / static_cast<float>(attack);
        if (fall < 0.0f) {
            fall = 0.0f;
        }
    }
    return rise < fall ? rise : fall;
}

} // namespace

void SliceEngine::readReversed(const SampleBuffer& buffer, const TrackPlay& play, int slot, int position, float& left, float& right) const {
    const int slice = sliceFrames();
    // The global beat is the part length. A longer beat keeps the slice as one part.
    int parts = static_cast<int>(std::llround(grid_.sliceBeats() / globalBeat_));
    if (parts < 1) {
        parts = 1;
    }
    int part = slice / parts;
    if (part < 1) {
        part = 1;
    }
    const PartRead read = partRead(offsetInSlice(slot, position), slice, part, parts);
    float revL = 0.0f;
    float revR = 0.0f;
    take(buffer, frameAt(buffer, play, slot, read.mirrored), revL, revR);
    voiceGain(play, revL, revR);
    const float env = copyEnvelope(read.offset, read.length, attackFrames(globalBeat_, sampleRate_));
    left = left + (revL - left) * env;
    right = right + (revR - right) * env;
}

void SliceEngine::hear(const SampleBuffer& buffer, const TrackPlay& play, int slot, int position, float& left, float& right) const {
    take(buffer, frameIn(buffer, play, slot, position), left, right);
    voiceGain(play, left, right);
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
