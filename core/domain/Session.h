#pragma once

#include "Rng.h"

#include <cstdint>

namespace bt {

// One chosen track index, looped for that track's own duration.
// The volume curve lives in the engine. This type only keeps musical state.
class Session {
public:
    static constexpr int kMaxTracks = 32;

    explicit Session(std::uint64_t seed);

    // First call with no index picks one track. Later calls keep that index.
    // Starts at position 0 when playback was stopped. Empty list: no effect.
    void play();

    // Stops. Position returns to 0. The chosen index stays.
    void stop();

    // Picks a new index, returns to position 0, and ends playing.
    // Empty list: no effect.
    void randomize();

    // Adds a track at the end. Does not pick a new index: a batch of files
    // is several appends, then one randomize. Returns false when the list is
    // full or the duration is not positive.
    bool append(double durationSec);

    // Removes index 0. If anything remains, randomizes and plays.
    // The last track: stops, clears the index. Empty list: no effect.
    void removeFirst();

    // Moves the playhead while playing, wrapping by the chosen track's duration.
    void advance(double seconds);

    int count() const;
    int index() const;          // -1 when nothing is chosen
    bool playing() const;
    double position() const;
    double duration() const;    // chosen track, or 0
    double trackDuration(int trackIndex) const;

private:
    Rng rng_;
    double durations_[kMaxTracks]{};
    int count_ = 0;
    int index_ = -1;
    bool playing_ = false;
    double position_ = 0;
};

} // namespace bt
