#pragma once

#include "Curve.h"
#include "EffectsBank.h"
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
    int playSlot = -1;
    int playTrack = -1;
    // 0 at the start of the loop, just under 1 at the end. 0 while stopped.
    double playhead = 0;
    // One extra slot: a fade can still be holding a buffer that has left the bank.
    std::uint32_t released[SampleBank::kCapacity + 1]{};
    int releasedCount = 0;
};

// The grid, the sequence, the samples, and two gains.
// slice_ follows the playhead through a slice boundary.
// play_ is the transport. A new play replaces it; the one leaving is outgoing_.
// play() and stop() return the playhead to 0.
class SliceEngine {
public:
    static constexpr int kMaxTracks = SampleBank::kCapacity;
    static constexpr int kAttackMinMs = 2;
    static constexpr int kAttackMaxMs = 16;
    static constexpr double kGlobalPowerMin = 0;
    static constexpr double kGlobalPowerMax = 1;
    static constexpr double kReverbPowerMin = 0;
    static constexpr double kReverbPowerMax = 1;
    static constexpr double kReverbChanceMin = 0;
    static constexpr double kReverbChanceMax = 1;
    static constexpr double kDelayPowerMin = 0;
    static constexpr double kDelayPowerMax = 1;
    static constexpr double kDelayChanceMin = 0;
    static constexpr double kDelayChanceMax = 1;
    static constexpr double kGlobalChanceMin = 0;
    static constexpr double kGlobalChanceMax = 1;
    // Global beat is 2^exponent beats. -4 is 1/16, 1 is 2.
    static constexpr int kGlobalBeatExpMin = -4;
    static constexpr int kGlobalBeatExpMax = 1;

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
    // power is 0..1 and scales every effect. Default 1.
    void setGlobalPower(double power);
    // exponent selects 2^exponent beats, from 1/16 through 2. Default 1 beat.
    void setGlobalBeat(int exponent);
    // chance is 0..1. A slice plays its stored effect when its roll is below this. Default 0.
    void setGlobalChance(double chance);
    // power is 0..1 and scales the reverb. Default 1.
    void setReverbPower(double power);
    // chance is 0..1. Default 0. The reverb's share of the effect chosen when the sequence is written.
    void setReverbChance(double chance);
    // power is 0..1 and scales the delay. Default 1.
    void setDelayPower(double power);
    // chance is 0..1. Default 0. The delay's share of the effect chosen when the sequence is written.
    void setDelayChance(double chance);
    // volume is 0..1.2 and scales the mix. The host multiplies that by note velocity.
    // pan is -1..1 and balances the two channels.
    void setOutput(double volume, double pan);
    // Keeps the volume and pan already on that slot.
    void setTrack(int index, double start, double length, bool loop);
    // Web track. start is a fraction of the file, 0..1.
    void setIndexedTrack(int index, double start, double length, bool loop, double volume, double pan);
    // Written after bpm, loop, and slice, which would otherwise build a new sequence.
    void installSequence(const std::uint16_t* slots, int size, int savedCount);

    int count() const { return bank_.count(); }
    int sequenceSize() const { return sequence_.size(); }
    int sequenceSavedCount() const { return sequence_.savedCount(); }
    std::uint16_t sequenceSlot(int index) const { return sequence_.data()[index]; }

    void render(float* left, float* right, int frames);
    void fillSnapshot(SliceSnapshot& out);

private:
    void handoff(const SampleBuffer& from);
    void syncSequence(int oldExp, int oldSlots);
    void place(double beats);
    void listen();

    void mixSlice(float& left, float& right);
    void affect(EffectsBank& bank, int slot, int position, float& left, float& right);
    int offsetInSlice(int slot, int position) const;
    void applyPlay(float& left, float& right) const;
    void mixOutgoing(float& left, float& right);
    void advance();
    void cleanBanks();
    int heard() const;

    const SampleBuffer& bufferForSlot(int slot) const;
    int frameIn(const SampleBuffer& buffer, const TrackPlay& play, int slot, int position) const;
    void remember(const SampleBuffer& buffer);
    void take(const SampleBuffer& buffer, int frame, float& left, float& right) const;
    void hear(const SampleBuffer& buffer, const TrackPlay& play, int slot, int position, float& left, float& right) const;

    int fadeFrames() const;
    int sliceFrames() const;
    int loopFrames() const;
    double framesPerBeat() const;

    double sampleRate_;
    int attackMs_ = kAttackMinMs;
    double globalPower_ = 1;
    double globalBeat_ = 1;
    double globalChance_ = 0;
    double reverbPower_ = 1;
    double reverbChance_ = 0;
    double delayPower_ = 1;
    double delayChance_ = 0;
    double volume_ = 1;
    double pan_ = 0;
    EffectsBank currentBank_;
    EffectsBank decayingBank_;
    // True while the attack fade is mixing the slot that is leaving.
    bool fading_ = false;
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
    TrackPlay outgoingPlay_{};
    std::uint32_t pending_ = 0;
    bool pendingHeld_ = false;

    std::uint32_t released_[kMaxTracks + 1]{};
    int releasedCount_ = 0;
};

} // namespace bt
