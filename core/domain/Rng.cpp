#include "Rng.h"

namespace bt {

namespace {

// SplitMix64. The same step feeds track picks and effect rolls.
std::uint64_t mix(std::uint64_t& state) {
    state += 0x9E3779B97F4A7C15ull;
    std::uint64_t z = state;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
}

} // namespace

Rng::Rng(std::uint64_t seed) : state_(seed) {}

int Rng::nextInt(int n) {
    if (n <= 0) {
        return 0;
    }
    return static_cast<int>(mix(state_) % static_cast<std::uint64_t>(n));
}

float Rng::nextFloat() {
    // 24 bits is the whole float mantissa, so the result stays below 1.
    return static_cast<float>(mix(state_) >> 40) * (1.0f / 16777216.0f);
}

} // namespace bt
