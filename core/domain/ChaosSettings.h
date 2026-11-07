#pragma once

namespace bt {

// What fires a chaos roll on its own. The CHAOS button fires one in every mode.
// Note fires on each note-on. Loop, Slices, and Beats fire each time that many have played since the note started.
// None never rolls on its own. The Randomize button only writes a new sequence.
enum class ChaosTrigger { Note, Loop, Slices, Beats, None };

// The knob groups a roll can change. Each one is on or off as a whole.
// EffectsGlobal is the global power, the global chance, and the effect time. EffectsPrivate is each effect's power and chance.
// RepeatParams is the beat repeat size, mix, length, and chance.
enum class ChaosGroup {
    Pan,
    Slices,
    Randomize,
    EffectsGlobal,
    EffectsOn,
    EffectsPrivate,
    RepeatOn,
    RepeatPositions,
    RepeatParams,
    Value,
    Time,
    Count
};

// The chaos knobs.
// value is 0..1. It widens each knob's range from the range at 0 toward the range at 1.
// beatSize is 2^beatSize beats, 1/4..2. loopSize is loops, 1..8. sliceSize is 2^sliceSize slices, 1/2..4.
struct ChaosSettings {
    static constexpr int kGroups = static_cast<int>(ChaosGroup::Count);
    static constexpr int kBeatSizeMin = -2;
    static constexpr int kBeatSizeMax = 1;
    static constexpr int kLoopSizeMin = 1;
    static constexpr int kLoopSizeMax = 8;
    static constexpr int kSliceSizeMin = -1;
    static constexpr int kSliceSizeMax = 1;

    ChaosTrigger trigger = ChaosTrigger::None;
    double value = 0;
    bool groups[kGroups]{};
    int beatSize = 0;
    int loopSize = 1;
    int sliceSize = 0;

    bool on(ChaosGroup group) const { return groups[static_cast<int>(group)]; }

    bool operator==(const ChaosSettings&) const = default;
};

} // namespace bt
