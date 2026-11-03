#include "SliceEngine.h"

#include <utility>

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

void movePlayingOut(SlicePlayer& playing, SlicePlayer& outgoing, Clock& playingClock, Clock& outgoingClock, int& playingSlot,
                    SampleBuffer& playingBuffer, SampleBuffer& outgoingBuffer) {
    if (playing.hasStopped()) {
        return;
    }
    const bool running = playing.running();
    playing.stop();
    std::swap(playing, outgoing);
    std::swap(playingBuffer, outgoingBuffer);
    outgoing.setRunning(false);
    playing.setRunning(running);
    outgoingClock = playingClock;
    playingSlot = -1;
}

} // namespace

SliceEngine::SliceEngine(double sampleRate, std::uint64_t seed)
    : settings_{sampleRate, 120.0}, playing_(sampleRate, seed), outgoing_(sampleRate, seed + 1), rng_(seed),
      repeatRng_(seed + 2), beatRepeat_(sampleRate) {}

void SliceEngine::play() {
    if (sequence_.empty()) {
        sequence_.generate(grid_.slotCount(), bank_.count(), rng_, effects_);
        repeatSequence_.generate(repeatRng_);
    }
    beatRepeat_.clean();
    if (playing_.isPlaying()) {
        movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
        playingClock_.seek(0);
        if (!sequence_.empty() && bank_.count() > 0) {
            const int track = sequence_.indexAt(0, bank_.count());
            playingBuffer_ = bank_.at(track);
            playing_.setSlice(bank_.play(track), bank_.warp(track), 0, sequence_.effectAt(0), sequence_.rollAt(0), sequence_.panRollAt(0));
            playingSlot_ = 0;
        } else {
            playingSlot_ = -1;
        }
    } else {
        playingClock_.seek(0);
        playingSlot_ = -1;
    }
    playing_.setRunning(true);
}

void SliceEngine::stop() {
    if (playing_.running()) {
        playing_.stop();
    }
    playing_.setRunning(false);
}

void SliceEngine::randomize() {
    const bool live = playing_.isPlaying();
    const bool restart = !playing_.running();
    sequence_.generate(grid_.slotCount(), bank_.count(), rng_, effects_);
    repeatSequence_.generate(repeatRng_);
    if (!live) {
        return;
    }
    movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
    if (restart) {
        playingClock_.seek(0);
        beatRepeat_.clean();
    }
    const int slot = restart ? 0 : playingClock_.sliceIndex(settings_, grid_);
    if (slot >= 0 && !sequence_.empty() && bank_.count() > 0) {
        const int track = sequence_.indexAt(slot, bank_.count());
        playingBuffer_ = bank_.at(track);
            playing_.setSlice(bank_.play(track), bank_.warp(track), slot, sequence_.effectAt(slot), sequence_.rollAt(slot), sequence_.panRollAt(slot));
        playingSlot_ = slot;
    } else {
        playingSlot_ = -1;
    }
    playing_.setRunning(true);
}

void SliceEngine::append(const SampleBuffer& buffer) {
    const bool live = playing_.running() && !sequence_.empty();
    bank_.append(buffer);
    if (!live) {
        return;
    }
    const int slot = playingClock_.sliceIndex(settings_, grid_);
    movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
    if (slot >= 0 && bank_.count() > 0) {
        const int track = sequence_.indexAt(slot, bank_.count());
        playingBuffer_ = bank_.at(track);
            playing_.setSlice(bank_.play(track), bank_.warp(track), slot, sequence_.effectAt(slot), sequence_.rollAt(slot), sequence_.panRollAt(slot));
        playingSlot_ = slot;
    } else {
        playingSlot_ = -1;
    }
}

void SliceEngine::setTrack(int index, double start, double length, bool loop) {
    if (index < 0 || index >= bank_.count()) {
        return;
    }
    SampleSettings play = bank_.play(index);
    play.start = unit(start);
    play.length = unit(length);
    play.loop = loop;
    bank_.setPlay(index, play);
}

void SliceEngine::installSequence(const std::uint16_t* slots, int size, int savedCount) {
    sequence_.assign(slots, size, savedCount);
    repeatSequence_.clear();
}

void SliceEngine::setIndexedTrack(int index, double start, double length, bool loop, double volume, double pan) {
    if (index < 0 || index >= bank_.count()) {
        return;
    }
    bank_.setPlay(index, SampleSettings{
                             .start = unit(start),
                             .length = unit(length),
                             .loop = loop,
                             .volume = clamp(volume, 0.0, 1.2),
                             .pan = clamp(pan, -1.0, 1.0),
                         });
}

void SliceEngine::setWarp(int index, const WarpSettings& warp) {
    if (index < 0 || index >= bank_.count()) {
        return;
    }
    bank_.setWarp(index, WarpSettings{
                             .mode = warp.mode,
                             .bpm = clamp(warp.bpm, 1.0, 999.9),
                             .param = unit(warp.param),
                         });
}

void SliceEngine::remove(int index) {
    SampleBuffer from{};
    const bool live = playing_.isPlaying() && !sequence_.empty();
    if (live) {
        const int slot = playingClock_.sliceIndex(settings_, grid_);
        if (slot >= 0) {
            from = bank_.at(sequence_.indexAt(slot, bank_.count()));
        }
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
        movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
        playing_.setRunning(false);
        playingSlot_ = -1;
        return;
    }
    const int slot = playingClock_.sliceIndex(settings_, grid_);
    movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
    if (slot >= 0 && !sequence_.empty()) {
        const int track = sequence_.indexAt(slot, bank_.count());
        playingBuffer_ = bank_.at(track);
            playing_.setSlice(bank_.play(track), bank_.warp(track), slot, sequence_.effectAt(slot), sequence_.rollAt(slot), sequence_.panRollAt(slot));
        playingSlot_ = slot;
    } else {
        playingSlot_ = -1;
    }
}

void SliceEngine::clear() {
    SampleBuffer from{};
    const bool live = playing_.isPlaying() && !sequence_.empty() && bank_.count() > 0;
    if (live) {
        const int slot = playingClock_.sliceIndex(settings_, grid_);
        if (slot >= 0) {
            from = bank_.at(sequence_.indexAt(slot, bank_.count()));
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
        movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
        playing_.setRunning(false);
        playingSlot_ = -1;
        return;
    }

    playing_.drop();
    playingSlot_ = -1;
    if (pendingHeld_ && outgoing_.hasStopped()) {
        released_[releasedCount_++] = pending_;
        pendingHeld_ = false;
    }
}

void SliceEngine::setBpm(double bpm) {
    grid_.setBpm(bpm);
    settings_.bpm = bpm;
}

void SliceEngine::setLoop(int beats) {
    const int oldExp = grid_.sliceExp();
    const int oldSlots = grid_.slotCount();
    const bool live = playing_.running() && !sequence_.empty();
    grid_.setLoop(beats);
    syncSequence(oldExp, oldSlots);
    if (!live) {
        return;
    }
    const int slot = playingClock_.sliceIndex(settings_, grid_);
    movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
    if (slot >= 0 && !sequence_.empty() && bank_.count() > 0) {
        const int track = sequence_.indexAt(slot, bank_.count());
        playingBuffer_ = bank_.at(track);
            playing_.setSlice(bank_.play(track), bank_.warp(track), slot, sequence_.effectAt(slot), sequence_.rollAt(slot), sequence_.panRollAt(slot));
        playingSlot_ = slot;
    } else {
        playingSlot_ = -1;
    }
}

void SliceEngine::setSlice(int exponent) {
    const int oldExp = grid_.sliceExp();
    const int oldSlots = grid_.slotCount();
    const bool live = playing_.running() && !sequence_.empty();
    grid_.setSlice(exponent);
    syncSequence(oldExp, oldSlots);
    if (!live) {
        return;
    }
    const int slot = playingClock_.sliceIndex(settings_, grid_);
    movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
    if (slot >= 0 && !sequence_.empty() && bank_.count() > 0) {
        const int track = sequence_.indexAt(slot, bank_.count());
        playingBuffer_ = bank_.at(track);
            playing_.setSlice(bank_.play(track), bank_.warp(track), slot, sequence_.effectAt(slot), sequence_.rollAt(slot), sequence_.panRollAt(slot));
        playingSlot_ = slot;
    } else {
        playingSlot_ = -1;
    }
}

void SliceEngine::setAttack(int ms) { attackMs_ = ms; }

void SliceEngine::setEffectsSettings(const Effects& settings) {
    effects_ = settings;
    playing_.setEffects(settings);
    outgoing_.setEffects(settings);
}

void SliceEngine::setBeatRepeat(const BeatRepeatSettings& settings) { beatRepeatSettings_ = settings; }

void SliceEngine::setOutput(double volume, double panMin, double panMax) {
    volume_ = clamp(volume, 0.0, 1.2);
    panMin_ = clamp(panMin, -1.0, 1.0);
    panMax_ = clamp(panMax, panMin_, 1.0);
    playing_.setPanRange(panMin_, panMax_);
    outgoing_.setPanRange(panMin_, panMax_);
}

void SliceEngine::render(float* left, float* right, int frames) {
    for (int i = 0; i < frames; ++i) {
        if (playing_.running() && !sequence_.empty() && bank_.count() > 0) {
            const int arriving = playingClock_.arrivingSlot(settings_, grid_, attackMs_);
            if (arriving != playingSlot_) {
                movePlayingOut(playing_, outgoing_, playingClock_, outgoingClock_, playingSlot_, playingBuffer_, outgoingBuffer_);
                if (arriving >= 0) {
                    const int track = sequence_.indexAt(arriving, bank_.count());
                    playingBuffer_ = bank_.at(track);
            playing_.setSlice(bank_.play(track), bank_.warp(track), arriving, sequence_.effectAt(arriving), sequence_.rollAt(arriving), sequence_.panRollAt(arriving));
                    playingSlot_ = arriving;
                } else {
                    playingSlot_ = -1;
                }
            } else if (arriving >= 0) {
                const int track = sequence_.indexAt(arriving, bank_.count());
                playingBuffer_ = bank_.at(track);
                playing_.setPlay(bank_.play(track), bank_.warp(track));
            }
        }
        float playL = 0.0f;
        float playR = 0.0f;
        float outL = 0.0f;
        float outR = 0.0f;
        playing_.render(playingBuffer_, settings_, playingClock_, grid_, attackMs_, playL, playR);
        outgoing_.render(outgoingBuffer_, settings_, outgoingClock_, grid_, attackMs_, outL, outR);
        Frame mixed{playL + outL, playR + outR};
        if (playing_.isPlaying()) {
            mixed = beatRepeat_.render(mixed, settings_, playingClock_, grid_, beatRepeatSettings_, repeatSequence_);
        }
        left[i] = mixed.l;
        right[i] = mixed.r;
        if (playing_.isPlaying()) {
            playingClock_.tick();
        }
        if (outgoing_.isPlaying()) {
            outgoingClock_.tick();
        }
        if (pendingHeld_ && outgoing_.hasStopped()) {
            released_[releasedCount_++] = pending_;
            pendingHeld_ = false;
        }
    }
    const float volume = static_cast<float>(volume_);
    if (volume == 1.0f) {
        return;
    }
    for (int i = 0; i < frames; ++i) {
        left[i] *= volume;
        right[i] *= volume;
    }
}

void SliceEngine::fillSnapshot(SliceSnapshot& out) {
    out.count = bank_.count();
    out.playing = playing_.running();
    out.sliceExp = grid_.sliceExp();
    out.loopBeats = grid_.loopBeats();
    out.bpm = grid_.bpm();
    out.playSlot = -1;
    out.playTrack = -1;
    out.playhead = 0.0;
    const double loopSec = static_cast<double>(grid_.loopBeats()) * 60.0 / settings_.bpm;
    if (playing_.running() && loopSec > 0.0) {
        out.playhead = playingClock_.seconds(settings_, grid_) / loopSec;
    }
    const int slot = playingClock_.sliceIndex(settings_, grid_);
    if (playing_.running() && slot >= 0 && bank_.count() > 0 && !sequence_.empty()) {
        out.playSlot = slot;
        out.playTrack = sequence_.indexAt(slot, bank_.count());
    }
    out.releasedCount = releasedCount_;
    for (int i = 0; i < releasedCount_; ++i) {
        out.released[i] = released_[i];
    }
    releasedCount_ = 0;
}

void SliceEngine::syncSequence(int oldExp, int oldSlots) {
    if (sequence_.empty()) {
        return;
    }
    const int exp = grid_.sliceExp();
    const int slots = grid_.slotCount();
    if (exp != oldExp) {
        sequence_.generate(slots, bank_.count(), rng_, effects_);
        repeatSequence_.generate(repeatRng_);
    } else if (slots > oldSlots) {
        sequence_.append(slots, rng_, effects_);
    } else if (slots < oldSlots) {
        sequence_.crop(slots);
    }
}

} // namespace bt
