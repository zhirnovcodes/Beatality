#include "BeatRepeat.h"

#include "Delay.h"

#include <cmath>
#include <new>

namespace bt {

BeatRepeat::BeatRepeat(double sampleRate) {
    const int frames = static_cast<int>(std::llround(sampleRate * 4.0)) + attackFrames(2.0, sampleRate);
    capacity_ = frames > 0 ? frames : 1;
    left_.reset(new (std::nothrow) float[static_cast<std::size_t>(capacity_)]());
    right_.reset(new (std::nothrow) float[static_cast<std::size_t>(capacity_)]());
}

Frame BeatRepeat::render(Frame in, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                         const BeatRepeatSettings& repeat, const RepeatSequence& rolls) {
    const int loop = clock.loopFrames(settings, grid);
    const int position = static_cast<int>(clock.frame() % loop);
    if (active_ && (!repeat.enabled || position < lastPosition_ || elapsed_ >= length_ + tail_)) {
        release();
    }
    lastPosition_ = position;

    for (int i = 0; repeat.enabled && i < RepeatSequence::kPositions; ++i) {
        const int start = static_cast<int>(std::llround(static_cast<double>(loop) * i / RepeatSequence::kPositions));
        if (position != start) {
            continue;
        }
        if (repeat.positions[i] && rolls.rollAt(i) < repeat.chance) {
            if (active_) {
                release();
            }
            const double beats = repeat.beats(rolls.sizeRollAt(i));
            int length = static_cast<int>(std::llround(beats * settings.framesPerBeat()));
            int attack = attackFrames(beats, settings.sampleRate);
            if (length > capacity_ - attack) {
                length = capacity_ - attack;
            }
            if (attack > length / 2) {
                attack = length / 2 > 0 ? length / 2 : 1;
            }
            active_ = true;
            elapsed_ = 0;
            length_ = length;
            tail_ = static_cast<int>(std::llround(repeat.lengthBeats() * settings.framesPerBeat()));
            attack_ = attack;
        }
        break;
    }

    Frame wet = in;
    if (active_) {
        // Recorded past the size, so the join into the next copy has the frames that followed.
        if (elapsed_ < length_ + attack_) {
            left_[static_cast<std::size_t>(elapsed_)] = in.l;
            right_[static_cast<std::size_t>(elapsed_)] = in.r;
        }
        const int copy = elapsed_ / length_;
        const int x = elapsed_ % length_;
        if (copy > 0) {
            if (x == 0) {
                fadeFrom(length_);
            }
            wet = {left_[static_cast<std::size_t>(x)], right_[static_cast<std::size_t>(x)]};
        }
        ++elapsed_;
    }
    if (fading_) {
        const float rise = fade_.y(fadeElapsed_);
        const std::size_t at = static_cast<std::size_t>(fadeFrom_ + fadeElapsed_);
        wet.l = left_[at] + (wet.l - left_[at]) * rise;
        wet.r = right_[at] + (wet.r - right_[at]) * rise;
        if (++fadeElapsed_ >= fadeLength_) {
            fading_ = false;
        }
    }
    mix_.set(static_cast<float>(repeat.mix));
    mix_.tick(1.0 / settings.sampleRate);
    const float mix = mix_.get();
    return {in.l + (wet.l - in.l) * mix, in.r + (wet.r - in.r) * mix};
}

void BeatRepeat::release() {
    // During the recording, and on its last frame, the dry frames are already what plays.
    if (elapsed_ > length_) {
        const int x = elapsed_ % length_;
        if (x == 0) {
            fadeFrom(length_);
        } else if (!fading_) {
            fadeFrom(x);
        }
    }
    active_ = false;
}

void BeatRepeat::fadeFrom(int index) {
    fading_ = true;
    fadeFrom_ = index;
    fadeElapsed_ = 0;
    fadeLength_ = attack_;
    fade_.setLength(attack_);
}

void BeatRepeat::clean() {
    lastPosition_ = -1;
    active_ = false;
    elapsed_ = 0;
    fading_ = false;
    fadeElapsed_ = 0;
}

} // namespace bt
