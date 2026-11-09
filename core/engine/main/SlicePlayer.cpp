#include "SlicePlayer.h"

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

} // namespace

SlicePlayer::SlicePlayer(double sampleRate, std::uint64_t seed) : bank_(sampleRate, seed) {
    curve_.stop(0);
    // One-pole step for a 5 ms time constant.
    smooth_ = static_cast<float>(1.0 - std::exp(-1.0 / (0.005 * sampleRate)));
}

void SlicePlayer::setSlice(const SampleSettings& play, const WarpSettings& warp, int slot, EffectId effect, float roll, float panRoll, float beatRoll) {
    play_ = play;
    warp_ = warp;
    slot_ = slot;
    effect_ = effect;
    roll_ = roll;
    panRoll_ = panRoll;
    beatRoll_ = beatRoll;
    bank_.clean();
    curve_ = Curve();
    at_ = 0;
}

void SlicePlayer::setPlay(const SampleSettings& play, const WarpSettings& warp) {
    if (play_.start == play.start && play_.length == play.length && play_.loop == play.loop && play_.volume == play.volume &&
        play_.pan == play.pan && warp_.mode == warp.mode && warp_.bpm == warp.bpm && warp_.param == warp.param) {
        return;
    }
    play_ = play;
    warp_ = warp;
}

void SlicePlayer::setEffects(const Effects& effects) { effects_ = effects; }

void SlicePlayer::setPanRange(double min, double max) {
    panMin_ = min;
    panMax_ = max;
}

void SlicePlayer::stop() {
    if (curve_.fadingOut()) {
        return;
    }
    curve_.stop(at_);
}

void SlicePlayer::drop() {
    curve_.stop(0);
    at_ = 0;
    running_ = false;
    bank_.clean();
}

void SlicePlayer::render(const SampleBuffer& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid, int attackMs,
                         float& left, float& right) {
    left = 0.0f;
    right = 0.0f;
    if (curve_.fadingOut() && !(curve_.y(at_) > 0.0f)) {
        return;
    }
    if (!curve_.fadingOut()) {
        curve_.setLength(clock.fadeFrames(settings, grid, attackMs));
    }
    // The first sample of a slice takes the knobs as they are. The fade-in covers the start.
    const bool first = at_ == 0;
    const float gain = curve_.y(at_);
    ++at_;
    const SliceReader reader(slice, play_, warp_, settings, grid, slot_, clock.sliceFrames(settings, grid));

    double localPower = effects_.reversePower;
    if (effect_ == EffectId::Reverb) {
        localPower = effects_.reverbPower;
    } else if (effect_ == EffectId::Delay) {
        localPower = effects_.delayPower;
    } else if (effect_ == EffectId::Filter) {
        localPower = effects_.filterPower;
    } else if (effect_ == EffectId::Flanger) {
        localPower = effects_.flangerPower;
    } else if (effect_ == EffectId::Trance) {
        localPower = effects_.trancePower;
    } else if (effect_ == EffectId::Shift) {
        localPower = effects_.shiftPower;
    }
    const float localTarget = static_cast<float>(unit(localPower));
    const float globalTarget = static_cast<float>(effects_.globalPower);
    const float wetTarget = effects_.enabled && roll_ < effects_.globalChance && effect_ != EffectId::None ? 1.0f : 0.0f;
    if (first) {
        localPower_ = localTarget;
        globalPower_ = globalTarget;
        wet_ = wetTarget;
    } else {
        localPower_ += (localTarget - localPower_) * smooth_;
        globalPower_ += (globalTarget - globalPower_) * smooth_;
        wet_ += (wetTarget - wet_) * smooth_;
        if (wetTarget == 0.0f && wet_ > 0.0f && wet_ < 1.0e-4f) {
            // The effect is off for now. If it comes back on this slice, it starts clean.
            wet_ = 0.0f;
            bank_.clean();
        }
    }

    Frame sample = reader.read(clock.localIn(slot_, settings, grid));
    if (wet_ > 0.0f) {
        bank_.bind(slot_);
        EffectParams params;
        params.power = static_cast<float>(unit(static_cast<double>(localPower_) * static_cast<double>(globalPower_)));
        params.localPower = localPower_;
        params.beats = effects_.beats(beatRoll_);
        params.slot = slot_;
        const Frame fx = bank_.apply(effect_, reader, settings, clock, grid, params);
        sample.l = sample.l * (1.0f - wet_) + fx.l * wet_;
        sample.r = sample.r * (1.0f - wet_) + fx.r * wet_;
    }

    const double pan = panMin_ + (static_cast<double>(panRoll_) + 1.0) * 0.5 * (panMax_ - panMin_);
    const float leftGain = static_cast<float>(pan <= 0.0 ? 1.0 : 1.0 - pan);
    const float rightGain = static_cast<float>(pan >= 0.0 ? 1.0 : 1.0 + pan);
    left = sample.l * gain * leftGain;
    right = sample.r * gain * rightGain;
}

} // namespace bt
