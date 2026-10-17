#include "Rng.h"

namespace bt {

Rng::Rng(std::uint64_t seed) : state_(seed) {}

int Rng::nextInt(int n) {
    if (n <= 0) {
        return 0;
    }
    // SplitMix64. Enough for picking one track index.
    state_ += 0x9E3779B97F4A7C15ull;
    std::uint64_t z = state_;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    z = z ^ (z >> 31);
    return static_cast<int>(z % static_cast<std::uint64_t>(n));
}

} // namespace bt
