#pragma once

#include <cstdint>

namespace bt {

// A track's audio at the output sample rate, planar stereo.
// The host owns the memory and frees it once the engine reports it released.
struct SampleBuffer {
    std::uint32_t id = 0;
    const float* left = nullptr;
    const float* right = nullptr;
    int frames = 0;

    bool valid() const { return left != nullptr && right != nullptr && frames > 0; }
};

} // namespace bt
