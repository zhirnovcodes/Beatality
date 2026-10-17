#pragma once

#include "Session.h"

#include <cstdint>

namespace bt {

// The state coming out of the core for display.
struct Snapshot {
    int count = 0;
    int index = -1;
    bool playing = false;
    double position = 0;
    double duration = 0;

    // Buffers no voice uses any more since the previous snapshot. The host frees them.
    std::uint32_t released[Session::kMaxTracks]{};
    int releasedCount = 0;
};

} // namespace bt
