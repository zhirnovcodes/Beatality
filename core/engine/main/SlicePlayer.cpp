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

void SlicePlayer::setSlice(const SampleSettings& play, int slot, EffectId effect, float roll) {
    play_ = play;
    slot_ = slot;
    effect_ = effect;
    roll_ = roll;
    bank_.clean();
    curve_ = Curve();
    at_ = 0;
}

void SlicePlayer::setPlay(const SampleSettings& play) {
    if (play_.start == play.start && play_.length == play.length && play_.loop == play.loop && play_.volume == play.volume &&
        play_.pan == play.pan) {
        return;
    }
    play_ = play;
}

void SlicePlayer::setEffects(const Effects& effects) { effects_ = effects; }

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
    const int sliceFrames = clock.sliceFrames(settings, grid);
    const int frame = frameAt(slice, play_, slot_, clock.localIn(slot_, settings, grid), sliceFrames, slicesAfter(slice, settings, grid));
    float sampleL = 0.0f;
    float sampleR = 0.0f;
    if (frame >= 0 && frame < slice.frames) {
        sampleL = slice.left[frame];
        sampleR = slice.right[frame];
    }
    voiceGain(play_, sampleL, sampleR);

    if (roll_ < effects_.globalChance && effect_ != EffectId::None) {
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
        params.beats = effects_.beatLength();
        params.play = play_;
        params.slot = slot_;
        params.maxSlices = slicesAfter(slice, settings, grid);
        bank_.apply(effect_, &sampleL, &sampleR, slice, settings, clock, grid, params);
    }

    // Warp joins here, between the effect and the curve.

    left = sampleL * gain;
    right = sampleR * gain;
}

int SlicePlayer::slicesAfter(const SampleBuffer& slice, const ClockSettings& settings, const SliceGrid& grid) const {
    const double durationSec = static_cast<double>(slice.frames) / settings.sampleRate;
    double start = play_.start;
    if (start < 0.0) {
        start = 0.0;
    } else if (start > 1.0) {
        start = 1.0;
    }
    return grid.trackSlices(durationSec * (1.0 - start));
}

} // namespace bt
