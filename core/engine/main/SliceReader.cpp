#include "SliceReader.h"

#include "Delay.h"

#include <cmath>
#include <limits>

namespace bt {

namespace {

constexpr int kFragmentExpMin = -5;
constexpr int kFragmentExpMax = 1;
constexpr double kGrainMinMs = 10.0;
constexpr double kGrainMaxMs = 200.0;
constexpr double kPi = 3.14159265358979323846;

double unit(double value) {
    if (value < 0.0) {
        return 0.0;
    }
    if (value > 1.0) {
        return 1.0;
    }
    return value;
}

// Beat mode: param 0 is a 1/32-beat fragment, param 1 is 2 beats, in seven powers of two.
double fragmentBeats(double param) {
    const int steps = kFragmentExpMax - kFragmentExpMin;
    return std::ldexp(1.0, kFragmentExpMin + static_cast<int>(std::lround(unit(param) * steps)));
}

// Grain mode: param 0 is a 10 ms grain, param 1 is 200 ms, on an exponential curve. In frames.
double grainFrames(double param, double sampleRate) {
    return kGrainMinMs * std::pow(kGrainMaxMs / kGrainMinMs, unit(param)) * 0.001 * sampleRate;
}

} // namespace

SliceReader::SliceReader(const SampleBuffer& buffer, const SampleSettings& play, const WarpSettings& warp, const ClockSettings& settings,
                         const SliceGrid& grid, int slot, int sliceFrames)
    : buffer_(buffer), play_(play) {
    // 1 when the BPMs match, so every position stays a whole frame and the read is exact.
    const double ratio = settings.bpm / warp.bpm;
    const double sourceSlice = static_cast<double>(sliceFrames) * ratio;

    const double start = unit(play.start);
    const double usableSec = static_cast<double>(buffer.frames) / settings.sampleRate * (1.0 - start);
    const int maxSlices = grid.trackSlices(usableSec / ratio);
    const int sliceCount = static_cast<int>(std::llround(unit(play.length) * (maxSlices - 1))) + 1;
    silent_ = !play.loop && slot >= sliceCount;
    const int startFrame = static_cast<int>(std::llround(start * buffer.frames));
    origin_ = static_cast<double>(startFrame) + static_cast<double>(slot % sliceCount) * sourceSlice;

    end_ = std::numeric_limits<double>::infinity();
    if (warp.mode == WarpMode::Pitch) {
        step_ = ratio;
    } else if (warp.mode == WarpMode::Beat) {
        const double beats = fragmentBeats(warp.param);
        fragmentOut_ = beats * settings.framesPerBeat();
        fragmentSource_ = fragmentOut_ * ratio;
        const double shorter = fragmentOut_ < fragmentSource_ ? fragmentOut_ : fragmentSource_;
        fade_ = static_cast<double>(attackFrames(beats, settings.sampleRate));
        if (fade_ > shorter * 0.5) {
            fade_ = shorter * 0.5;
        }
        // A fragment with enough audio is cut where the next one starts, and the two crossfade.
        // A short one fades out at its own end, and the rest of its place is silent.
        fadeOut_ = fragmentSource_ >= fragmentOut_ ? fragmentOut_ : fragmentSource_ - fade_;
    } else if (warp.mode == WarpMode::Grain) {
        grainHop_ = grainFrames(warp.param, settings.sampleRate) * 0.5;
        grainSourceHop_ = grainHop_ * ratio;
    } else if (sourceSlice < static_cast<double>(sliceFrames)) {
        end_ = sourceSlice;
    }
}

Frame SliceReader::read(double local) const {
    Frame frame;
    if (silent_ || !(local < end_)) {
        return frame;
    }
    if (fragmentOut_ > 0.0) {
        // The fragment under this frame, plus the tail of the one before while the two crossfade.
        const double index = std::floor(local / fragmentOut_);
        const double offset = local - index * fragmentOut_;
        const Frame current = fragment(index, offset);
        const Frame previous = fragment(index - 1.0, offset + fragmentOut_);
        frame.l = current.l + previous.l;
        frame.r = current.r + previous.r;
    } else if (grainHop_ > 0.0) {
        // The grain centred at or before this frame, and the next one.
        const double index = std::floor(local / grainHop_);
        const Frame current = grain(index, local);
        const Frame next = grain(index + 1.0, local);
        frame.l = current.l + next.l;
        frame.r = current.r + next.r;
    } else {
        frame = at(origin_ + local * step_);
    }
    voiceGain(play_, frame.l, frame.r);
    return frame;
}

Frame SliceReader::fragment(double index, double offset) const {
    float gain = 1.0f;
    if (offset < 0.0 || offset >= fadeOut_ + fade_) {
        return {};
    }
    if (offset < fade_) {
        gain = static_cast<float>(offset / fade_);
    } else if (offset >= fadeOut_) {
        gain = static_cast<float>(1.0 - (offset - fadeOut_) / fade_);
    }
    Frame frame = at(origin_ + index * fragmentSource_ + offset);
    frame.l *= gain;
    frame.r *= gain;
    return frame;
}

Frame SliceReader::grain(double index, double local) const {
    const double offset = local - index * grainHop_;
    if (!(std::fabs(offset) < grainHop_)) {
        return {};
    }
    // At its centre the grain reads the file at its own source position, so grain 0 starts the slice exactly at origin_.
    const float gain = static_cast<float>(0.5 * (1.0 + std::cos(kPi * offset / grainHop_)));
    Frame frame = at(origin_ + index * grainSourceHop_ + offset);
    frame.l *= gain;
    frame.r *= gain;
    return frame;
}

Frame SliceReader::at(double position) const {
    Frame frame;
    const double whole = std::floor(position);
    if (whole < 0.0 || whole >= static_cast<double>(buffer_.frames)) {
        return frame;
    }
    const int index = static_cast<int>(whole);
    const int next = index + 1 < buffer_.frames ? index + 1 : index;
    const float frac = static_cast<float>(position - whole);
    frame.l = buffer_.left[index] + (buffer_.left[next] - buffer_.left[index]) * frac;
    frame.r = buffer_.right[index] + (buffer_.right[next] - buffer_.right[index]) * frac;
    return frame;
}

} // namespace bt
