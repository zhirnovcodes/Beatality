#pragma once

namespace bt {

// A knob's range at chaos 0 and its range at chaos 1. The chaos value blends each end between them.
struct ChaosRange {
    double low0;
    double high0;
    double low1;
    double high1;
};

// The range of every knob a chaos roll changes, by panel. Tune them here.
// A roll is clamped to its knob's limits, so a range may reach past them.
// Every effect's power and chance share one range. The on/off knobs are an even chance and have none.
namespace chaosRanges {

namespace play {
// -1..1.
constexpr ChaosRange panMin{0, 0, -1, 0};
constexpr ChaosRange panMax{0, 0, 0, 1};
// 2^n beats, -4..4.
constexpr ChaosRange slices{-1, 4, -4, 0};
} // namespace play

namespace effects {
// 0..1. Powers reach past the max at chaos 1, so about a quarter of full-chaos rolls land on full power.
constexpr ChaosRange power{0, 0.75, 0.25, 1.33};
constexpr ChaosRange chance{0, 0.35, 0.2, 1};
// 2^n beats, -4..1. A min above the max is swapped.
constexpr ChaosRange timeMin{-2, 0, -4, 1};
constexpr ChaosRange timeMax{-2, 0, -4, 1};
// Each effect's own power and chance, 0..1.
constexpr ChaosRange effectPower{0, 0.75, 0.25, 1.33};
constexpr ChaosRange effectChance{0, 0.35, 0.2, 1};
} // namespace effects

namespace beatRepeat {
// 2^n beats, -5..1. A min above the max is swapped.
constexpr ChaosRange sizeMin{-2, -1, -5, 1};
constexpr ChaosRange sizeMax{-2, -1, -5, 1};
// 0..1.
constexpr ChaosRange mix{0, 0.5, 0, 1};
// 2^n beats, -4..1.
constexpr ChaosRange length{-1, 0, -4, 1};
// 0..1.
constexpr ChaosRange chance{0, 0.25, 0.25, 1.1};
} // namespace beatRepeat

namespace chaos {
// 0..1.
constexpr ChaosRange value{0, 0.5, 0, 1};
// 2^n beats, -2..1.
constexpr ChaosRange beatSize{-1, 0, -2, 1};
// Loops, 1..8.
constexpr ChaosRange loopSize{2, 4, 1, 8};
// 2^n slices, -1..1.
constexpr ChaosRange sliceSize{-1, 0, -1, 1};
} // namespace chaos

} // namespace chaosRanges

} // namespace bt
