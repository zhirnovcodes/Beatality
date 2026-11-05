#pragma once

#include "BeatRepeatSettings.h"
#include "ChaosSettings.h"
#include "Effects.h"

namespace bt {

// The grid, the fade, and the output.
// bpm is the tempo being played. The host resolves its own tempo and sync before it applies.
// loop is in beats, 1..32. sliceExp is 2^sliceExp beats, -4..4; the grid fits it to the loop.
// attackMs is 2..16. volume is 0..1.2 and scales the mix. panMin and panMax are -1..1, panMin never above panMax.
// Each slice's pan roll is scaled onto that range.
struct PlaySettings {
    double bpm = 120;
    int loop = 8;
    int sliceExp = 0;
    int attackMs = 2;
    double volume = 1;
    double panMin = 0;
    double panMax = 0;

    bool operator==(const PlaySettings&) const = default;
};

// Every knob the engine plays, written together through SliceEngine::apply.
struct Controls {
    PlaySettings play;
    Effects effects;
    // The rolls are drawn with the sequence.
    BeatRepeatSettings repeat;
    ChaosSettings chaos;

    bool operator==(const Controls&) const = default;
};

} // namespace bt
