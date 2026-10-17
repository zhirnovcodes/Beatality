#include "Engine.h"

#include "Ramp.h"

namespace bt {

Engine::Engine(double sampleRate, std::uint64_t seed)
    : sampleRate_(sampleRate), fadeLength_(fadeFrames(sampleRate)), session_(seed) {}

bool Engine::apply(const Command& command) {
    switch (command.type) {
    case Command::Type::Play:
        play();
        return true;
    case Command::Type::Stop:
        stop();
        return true;
    case Command::Type::Randomize:
        randomize();
        return true;
    case Command::Type::RemoveFirst:
        removeFirst();
        return true;
    case Command::Type::Append:
        return append(command.buffer);
    }
    return false;
}

void Engine::render(float* left, float* right, int frames) {
    for (int i = 0; i < frames; ++i) {
        left[i] = 0.0f;
        right[i] = 0.0f;
    }
    current_.render(left, right, frames);
    outgoing_.render(left, right, frames);
    session_.advance(frames / sampleRate_);
    collectReleased();
}

void Engine::fillSnapshot(Snapshot& out) {
    out.count = session_.count();
    out.index = session_.index();
    out.playing = session_.playing();
    out.position = session_.position();
    out.duration = session_.duration();
    for (int i = 0; i < releasedCount_; ++i) {
        out.released[i] = released_[i];
    }
    out.releasedCount = releasedCount_;
    releasedCount_ = 0;
}

void Engine::play() {
    if (session_.count() == 0) {
        return;
    }
    const bool wasPlaying = session_.playing();
    session_.play();
    if (!wasPlaying) {
        startChosen();
    }
}

void Engine::stop() {
    if (!session_.playing()) {
        return;
    }
    session_.stop();
    fadeOutCurrent();
}

void Engine::randomize() {
    if (session_.count() == 0) {
        return;
    }
    session_.randomize();
    startChosen();
}

bool Engine::append(const SampleBuffer& buffer) {
    if (!buffer.valid() || bank_.count() >= SampleBank::kCapacity) {
        return false;
    }
    if (!session_.append(buffer.frames / sampleRate_)) {
        return false;
    }
    return bank_.append(buffer);
}

void Engine::removeFirst() {
    if (session_.count() == 0 || removedCount_ >= SampleBank::kCapacity) {
        return;
    }
    removed_[removedCount_++] = bank_.removeFirst().id;
    session_.removeFirst();
    if (session_.count() > 0) {
        startChosen();
    } else {
        fadeOutCurrent();
    }
    collectReleased();
}

void Engine::startChosen() {
    fadeOutCurrent();
    current_.start(bank_.at(session_.index()), fadeLength_);
}

void Engine::fadeOutCurrent() {
    if (!current_.active()) {
        return;
    }
    outgoing_ = current_;
    outgoing_.fadeOut(fadeLength_);
    current_.cut();
}

void Engine::collectReleased() {
    int kept = 0;
    for (int i = 0; i < removedCount_; ++i) {
        const std::uint32_t id = removed_[i];
        if (!inUse(id) && releasedCount_ < SampleBank::kCapacity) {
            released_[releasedCount_++] = id;
        } else {
            removed_[kept++] = id;
        }
    }
    removedCount_ = kept;
}

bool Engine::inUse(std::uint32_t id) const {
    return (current_.active() && current_.bufferId() == id) ||
           (outgoing_.active() && outgoing_.bufferId() == id);
}

} // namespace bt
