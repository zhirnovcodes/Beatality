#pragma once

#include "SampleBuffer.h"

namespace bt {

// One user action going into the core. Numeric values are part of the web boundary.
struct Command {
    enum class Type : int {
        Play = 0,
        Stop = 1,
        Randomize = 2,
        RemoveFirst = 3,
        Append = 4,   // adds `buffer` without picking; the host follows a batch with one Randomize
    };

    Type type = Type::Play;
    SampleBuffer buffer{};
};

} // namespace bt
