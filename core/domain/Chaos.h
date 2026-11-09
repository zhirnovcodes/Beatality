#pragma once

#include "ChaosRanges.h"
#include "Controls.h"
#include "Rng.h"
#include "SliceGrid.h"

#include <cstdint>

namespace bt {

// roll is in [0, 1). Uniform between the two blended ends.
double chaosValue(const ChaosRange& range, double value, float roll);
// The blended ends rounded to whole steps. Each step between them gets an equal share of the roll.
int chaosStep(const ChaosRange& range, double value, float roll);

// What a roll asks of the engine besides the knobs.
struct ChaosRoll {
    bool randomize = false;
    // An effect's chance changed. Those chances only weight the effect ids when they are picked.
    bool regenerateEffects = false;
    // The beat repeat chance changed.
    bool regenerateRepeat = false;
};

// Rolls every group that is on into controls, from ChaosRanges.h, with the chaos value it had before the roll.
// Groups that are off keep their knobs. Randomize always writes a new sequence.
// The on/off knobs are an even chance whatever the value. A min above its max is swapped.
ChaosRoll rollChaos(Controls& controls, Rng& rng);

// Decides when chaos rolls, and rolls. It keeps no note or button state: the engine asks at the moment.
class Chaos {
public:
    explicit Chaos(std::uint64_t seed);

    // True on the frame that starts a new Loop, Slices, or Beats unit. frame is the playing clock's frame;
    // it starts at 0 with the note. The note start is not a roll. A new unit size starts counting again.
    bool tick(const ChaosSettings& settings, const SliceGrid& grid, double sampleRate, bool playing, std::int64_t frame);
    // True when a note-on rolls: in Note mode.
    bool noteOn(const ChaosSettings& settings) const;
    // One roll into controls, with chaos's own generator, so the slice picks do not move.
    ChaosRoll roll(Controls& controls);

private:
    Rng rng_;
    // The unit the count was made in, in frames, and how many whole units the clock has passed.
    std::int64_t unit_ = 0;
    std::int64_t index_ = 0;
};

} // namespace bt
