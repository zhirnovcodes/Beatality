#pragma once

#include <cmath>

namespace bt {

// The effect knobs, written together.
// Powers are 0..1 and scale that effect. Default 1. globalPower scales every effect.
// Chances are 0..1. Default 0. globalChance lets a slice play its stored effect
// when its roll is below this. Each other chance is that effect's share when the sequence is written.
// globalBeat is an exponent: 2^globalBeat beats, from 1/16 through 2. Default 0 is one beat.
// Reverse and trance powers are the dry/wet mix. Filter, flanger, and shift map their power themselves.
struct Effects {
    static constexpr double kPowerMin = 0;
    static constexpr double kPowerMax = 1;
    static constexpr double kChanceMin = 0;
    static constexpr double kChanceMax = 1;
    // -4 is 1/16 beat. 1 is 2 beats.
    static constexpr int kBeatMin = -4;
    static constexpr int kBeatMax = 1;

    double globalPower = 1;
    int globalBeat = 0;
    double globalChance = 0;
    double reverbPower = 1;
    double reverbChance = 0;
    double delayPower = 1;
    double delayChance = 0;
    double reversePower = 1;
    double reverseChance = 0;
    double filterPower = 1;
    double filterChance = 0;
    double flangerPower = 1;
    double flangerChance = 0;
    double trancePower = 1;
    double tranceChance = 0;
    double shiftPower = 1;
    double shiftChance = 0;

    double beatLength() const { return std::ldexp(1.0, globalBeat); }
};

} // namespace bt
