#include "Trance.h"

#include "Delay.h"

namespace bt {

namespace {

constexpr int kSteps = 8;
constexpr int kSequenceCount = 6;

// Each row is one play. Consecutive 1s are one curve. Consecutive 0s are one silence.
constexpr bool kSequences[kSequenceCount][kSteps] = {
    {true, false, true, false, true, false, true, false},
    {true, false, true, false, true, false, true, true},
    {true, true, true, false, true, false, true, true},
    {true, false, true, true, true, false, true, false},
    {true, true, true, true, true, false, true, false},
    {true, true, true, false, true, false, true, false},
};

struct Run {
    bool open = false;
    int steps = 0;
};

int collect(const bool* seq, Run* runs) {
    int count = 0;
    for (int i = 0; i < kSteps;) {
        int steps = 1;
        while (i + steps < kSteps && seq[i + steps] == seq[i]) {
            ++steps;
        }
        runs[count].open = seq[i];
        runs[count].steps = steps;
        ++count;
        i += steps;
    }
    return count;
}

double spanOf(const Run& run, double element, double attack) {
    const double sustain = static_cast<double>(run.steps) * element;
    if (run.open) {
        return attack + sustain + attack;
    }
    return sustain;
}

double patternLength(const Run* runs, int count, double element, double attack) {
    double total = 0.0;
    for (int i = 0; i < count; ++i) {
        total += spanOf(runs[i], element, attack);
    }
    return total;
}

float envelopeAt(const Run* runs, int count, double phase, double element, double attack) {
    double cursor = 0.0;
    for (int i = 0; i < count; ++i) {
        const double sustain = static_cast<double>(runs[i].steps) * element;
        const double span = spanOf(runs[i], element, attack);
        if (phase < cursor + span) {
            if (!runs[i].open) {
                return 0.0f;
            }
            const double t = phase - cursor;
            if (t < attack) {
                return static_cast<float>(t / attack);
            }
            if (t < attack + sustain) {
                return 1.0f;
            }
            return static_cast<float>(1.0 - (t - attack - sustain) / attack);
        }
        cursor += span;
    }
    return 0.0f;
}

} // namespace

Trance::Trance(std::uint64_t seed) : rng_(seed) {}

Frame Trance::apply(const SliceReader& slice, const ClockSettings& settings, const Clock& clock, const SliceGrid& grid,
                    const EffectParams& params) {
    const float wet = params.power;
    const double beats = params.beats;
    const double sampleRate = settings.sampleRate;
    // One sample moves the playhead by this many beats. The sustain and the gaps are counted in beats,
    // so a tempo change keeps them on the grid. The attack stays the short fade from attackFrames.
    const double framesPerBeat = settings.framesPerBeat();
    const double attack = static_cast<double>(attackFrames(beats, sampleRate)) / framesPerBeat;
    const double element = beats * 0.5;
    float mix = wet;
    if (mix < 0.0f) {
        mix = 0.0f;
    } else if (mix > 1.0f) {
        mix = 1.0f;
    }

    const Frame dry = slice.read(clock.localIn(params.slot, settings, grid));
    const float dryL = dry.l;
    const float dryR = dry.r;
    if (armed_) {
        sequence_ = rng_.nextInt(kSequenceCount);
        phase_ = 0.0;
        armed_ = false;
    }

    Run runs[kSteps];
    int runCount = collect(kSequences[sequence_], runs);
    double length = patternLength(runs, runCount, element, attack);
    if (phase_ >= length) {
        sequence_ = rng_.nextInt(kSequenceCount);
        phase_ = 0.0;
        runCount = collect(kSequences[sequence_], runs);
    }

    const float env = envelopeAt(runs, runCount, phase_, element, attack);
    const float wetL = dryL * env;
    const float wetR = dryR * env;
    phase_ += 1.0 / framesPerBeat;
    return {dryL + (wetL - dryL) * mix, dryR + (wetR - dryR) * mix};
}

void Trance::clean() {
    armed_ = true;
    phase_ = 0.0;
}

} // namespace bt
