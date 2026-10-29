#pragma once

#include "Rng.h"

namespace bt {

// Tempo-locked gate. Two steps of the sequence span one global beat.
// A run of 1s is one curve: attack, a sustain of that many half-beats, then a release.
// A run of 0s is silence of that many half-beats. The release follows the curve, then the silence.
// Attack and release share one length: 4 ms at a 1/16 beat, 10 ms at 2 beats, same as the delay.
// Each play, and each repeat of the pattern, draws one of the six sequences.
// Power is the dry/wet mix. Full power keeps the sustain and silences the gaps.
class Trance {
public:
    explicit Trance(std::uint64_t seed);

    void apply(float dryL, float dryR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR);
    void clean();

private:
    Rng rng_;
    int sequence_ = 0;
    double phase_ = 0;
    bool armed_ = true;
};

} // namespace bt
