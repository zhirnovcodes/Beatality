#include "SlicePlayer.h"

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

SlicePlayer::SlicePlayer(double sampleRate, std::uint64_t seed) : bank_(sampleRate, seed) { curve_.stop(0); }

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
    const float gain = curve_.y(at_);
    ++at_;
    const SliceReader reader(slice, play_, warp_, settings, grid, slot_, clock.sliceFrames(settings, grid));
    Frame sample;
    if (effects_.enabled && roll_ < effects_.globalChance && effect_ != EffectId::None) {
        bank_.bind(slot_);
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
        EffectParams params;
        params.power = static_cast<float>(unit(localPower * effects_.globalPower));
        params.beats = effects_.beats(beatRoll_);
        params.slot = slot_;
        sample = bank_.apply(effect_, reader, settings, clock, grid, params);
    } else {
        sample = reader.read(clock.localIn(slot_, settings, grid));
    }

    const double pan = panMin_ + (static_cast<double>(panRoll_) + 1.0) * 0.5 * (panMax_ - panMin_);
    const float leftGain = static_cast<float>(pan <= 0.0 ? 1.0 : 1.0 - pan);
    const float rightGain = static_cast<float>(pan >= 0.0 ? 1.0 : 1.0 + pan);
    left = sample.l * gain * leftGain;
    right = sample.r * gain * rightGain;
}

} // namespace bt
