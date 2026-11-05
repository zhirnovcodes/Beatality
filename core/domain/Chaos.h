#pragma once

#include "Controls.h"
#include "Rng.h"

namespace bt {

// A knob's range at chaos 0 and its range at chaos 1. The chaos value blends each end between them.
struct ChaosRange {
    double low0;
    double high0;
    double low1;
    double high1;
};

// roll is in [0, 1). Uniform between the two blended ends.
double chaosValue(const ChaosRange& range, double value, float roll);
// The blended ends rounded to whole steps. Each step between them gets an equal share of the roll.
int chaosStep(const ChaosRange& range, double value, float roll);

// What a roll asks of the engine besides the knobs.
struct ChaosRoll {
    bool randomize = false;
};

// Rolls every group that is on into controls, with the chaos value it had before the roll.
// Groups that are off keep their knobs. Randomize and the on/off knobs are an even chance whatever the value.
ChaosRoll rollChaos(Controls& controls, Rng& rng);

} // namespace bt
