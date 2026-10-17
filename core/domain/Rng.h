#pragma once

#include <cstdint>

namespace bt {

// Seeded generator. The same seed always produces the same series.
class Rng {
public:
    explicit Rng(std::uint64_t seed);

    // Uniform integer in [0, n). n must be positive.
    int nextInt(int n);

private:
    std::uint64_t state_;
};

} // namespace bt
