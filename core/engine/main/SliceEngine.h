#pragma once

#include "BeatRepeat.h"
#include "BeatRepeatSettings.h"
#include "Clock.h"
#include "Effects.h"
#include "RepeatSequence.h"
#include "Rng.h"
#include "SampleBank.h"
#include "SampleBuffer.h"
#include "Sequence.h"
#include "SliceGrid.h"
#include "SlicePlayer.h"

#include <cstdint>

namespace bt {

struct SliceSnapshot {
    int count = 0;
    bool playing = false;
    int sliceExp = 0;
    int loopBeats = 8;
    double bpm = 120.0;
    int playSlot = -1;
    int playTrack = -1;
    // 0 at the start of the loop, just under 1 at the end. 0 while stopped.
    double playhead = 0;
    // One extra slot: a fade can still be holding a buffer that has left the bank.
    std::uint32_t released[SampleBank::kCapacity + 1]{};
    int releasedCount = 0;
};

// The grid, the sequence, the samples, and two voices.
// playing_ is the slice that is arriving. outgoing_ is the one leaving.
// play() and stop() report the playhead at 0.
class SliceEngine {
public:
    static constexpr int kMaxTracks = SampleBank::kCapacity;
    static constexpr int kAttackMinMs = 2;
    static constexpr int kAttackMaxMs = 16;

    SliceEngine(double sampleRate, std::uint64_t seed);

    void play();
    void stop();
    void randomize();
    void append(const SampleBuffer& buffer);
    void remove(int index);
    void clear(); // bank empty; a live fade keeps its buffer until silence

    void setBpm(double bpm);
    void setLoop(int beats);
    void setSlice(int exponent);
    void setAttack(int ms);
    // Replaces every effect knob.
    void setEffectsSettings(const Effects& settings);
    // Replaces every beat repeat knob. The rolls are drawn with the sequence.
    void setBeatRepeat(const BeatRepeatSettings& settings);
    // volume is 0..1.2 and scales the mix. The host multiplies that by note velocity.
    // panMin and panMax are -1..1, panMin never above panMax. Each slice's pan roll is scaled onto that range.
    void setOutput(double volume, double panMin, double panMax);
    // Keeps the volume and pan already on that slot.
    void setTrack(int index, double start, double length, bool loop);
    // Web track. start is a fraction of the file, 0..1.
    void setIndexedTrack(int index, double start, double length, bool loop, double volume, double pan);
    // The track's own tempo, warp mode, and warp param. Keeps start, length, loop, volume, and pan.
    void setWarp(int index, const WarpSettings& warp);
    // Written after bpm, loop, and slice, which would otherwise build a new sequence.
    void installSequence(const std::uint16_t* slots, int size, int savedCount);

    int count() const { return bank_.count(); }
    int sequenceSize() const { return sequence_.size(); }
    int sequenceSavedCount() const { return sequence_.savedCount(); }
    std::uint16_t sequenceSlot(int index) const { return sequence_.data()[index]; }

    void render(float* left, float* right, int frames);
    void fillSnapshot(SliceSnapshot& out);

private:
    void syncSequence(int oldExp, int oldSlots);

    ClockSettings settings_;
    SlicePlayer playing_;
    SlicePlayer outgoing_;
    Rng rng_;
    int attackMs_ = kAttackMinMs;
    Effects effects_{};
    // Its own generator, so the slice picks for a seed stay the same.
    Rng repeatRng_;
    BeatRepeatSettings beatRepeatSettings_{};
    RepeatSequence repeatSequence_;
    BeatRepeat beatRepeat_;
    double volume_ = 1;
    double panMin_ = 0;
    double panMax_ = 0;
    SliceGrid grid_;
    Sequence sequence_;
    SampleBank bank_;
    Clock playingClock_;
    Clock outgoingClock_;
    // The sample each voice is playing. The outgoing one can outlive the bank.
    SampleBuffer playingBuffer_{};
    SampleBuffer outgoingBuffer_{};
    int playingSlot_ = -1;

    std::uint32_t pending_ = 0;
    bool pendingHeld_ = false;
    std::uint32_t released_[kMaxTracks + 1]{};
    int releasedCount_ = 0;
};

} // namespace bt
