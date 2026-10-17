#pragma once

#include "Command.h"
#include "SampleBank.h"
#include "Session.h"
#include "Snapshot.h"
#include "Voice.h"

#include <cstdint>

namespace bt {

// Applies commands, renders audio blocks and produces snapshots. Audio thread only.
class Engine {
public:
    Engine(double sampleRate, std::uint64_t seed);

    // Returns false when the command was rejected (an Append that does not fit).
    bool apply(const Command& command);

    // Overwrites L and R with the next block.
    void render(float* left, float* right, int frames);

    // Fills the snapshot and hands over the released buffer ids.
    void fillSnapshot(Snapshot& out);

private:
    void play();
    void stop();
    void randomize();
    bool append(const SampleBuffer& buffer);
    void removeFirst();

    void startChosen();       // crossfade from the current voice to the chosen track
    void fadeOutCurrent();
    void retire(Voice& voice);
    void collectReleased();
    bool inUse(std::uint32_t id) const;

    double sampleRate_;
    int fadeLength_;
    Session session_;
    SampleBank bank_;
    Voice current_;
    Voice outgoing_;

    std::uint32_t removed_[SampleBank::kCapacity]{};   // out of the bank, maybe still playing
    int removedCount_ = 0;
    std::uint32_t released_[SampleBank::kCapacity]{};
    int releasedCount_ = 0;
};

} // namespace bt
