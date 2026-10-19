#pragma once

#include "Curve.h"
#include "Rng.h"
#include "SampleBank.h"
#include "SampleBuffer.h"
#include "Sequence.h"
#include "SliceGrid.h"

#include <cstdint>

namespace bt {

struct SliceSnapshot {
    int count = 0;
    bool playing = false;
    int sliceExp = 0;
    int loopBeats = 8;
    double bpm = 120.0;
    std::uint32_t released[SampleBank::kCapacity]{};
    int releasedCount = 0;
};

// The grid, the sequence, the samples, and two gains.
// slice_ follows the playhead through a slice boundary.
// play_ is the transport. A new play replaces it; the one leaving is outgoing_.
// play() and stop() return the playhead to 0.
class SliceEngine {
public:
    static constexpr int kMaxTracks = SampleBank::kCapacity;

    SliceEngine(double sampleRate, std::uint64_t seed);

    void play();
    void stop();
    void randomize();
    void append(const SampleBuffer& buffer);
    void remove(int index);

    void setBpm(double bpm);
    void setLoop(int beats);
    void setSlice(int exponent);

    int count() const { return bank_.count(); }

    void render(float* left, float* right, int frames);
    void fillSnapshot(SliceSnapshot& out);

private:
    void handoff(const SampleBuffer& from);
    void syncSequence(int oldExp, int oldSlots);
    void place(double beats);
    void listen();

    void mixSlice(float& left, float& right) const;
    void applyPlay(float& left, float& right) const;
    void mixOutgoing(float& left, float& right);
    void advance();
    int heard() const;

    const SampleBuffer& bufferForSlot(int slot) const;
    int frameIn(const SampleBuffer& buffer, int slot, int position) const;
    void take(const SampleBuffer& buffer, int frame, float& left, float& right) const;

    int fadeFrames() const;
    int sliceFrames() const;
    int loopFrames() const;
    double framesPerBeat() const;

    double sampleRate_;
    Rng rng_;
    SliceGrid grid_;
    Sequence sequence_;
    SampleBank bank_;

    int position_ = 0;
    int fadePosition_ = 0;
    int clock_ = 0;
    bool playing_ = false;

    Curve slice_;
    Curve play_;
    int playAt_ = 0;

    Curve outgoing_;
    int outgoingAt_ = 0;
    int outgoingPosition_ = 0;
    SampleBuffer outgoingBuffer_{};
    std::uint32_t pending_ = 0;
    bool pendingHeld_ = false;

    std::uint32_t released_[kMaxTracks]{};
    int releasedCount_ = 0;
};

} // namespace bt
