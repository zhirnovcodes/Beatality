#pragma once

#include "BeatRepeatSettings.h"
#include "Effects.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <cstdint>
#include <vector>

// VST3 and standalone host. The message thread only queues commands.
// The audio thread owns the engine.
class Processor : public juce::AudioProcessor {
public:
    Processor();
    ~Processor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Beatality"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override {}
    void setStateInformation(const void*, int) override {}

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

    // Message thread. These queue work. They do not move the playhead.
    void appendFiles(const juce::Array<juce::File>& files);
    void removeTrack(int index);
    void removeFirstTrack();
    void randomizeTracks();
    void setBpm(double bpm);
    // On, the engine plays the host's tempo. Off, or with no host tempo, it plays bpm().
    void setBpmSync(bool on);
    void setLoop(int beats);
    void setSlice(int exponent);
    void setAttack(int ms);
    void setEffectsEnabled(bool on);
    void setGlobalPower(double power);
    // 2^exponent beats, -4..1. min is not above max.
    void setGlobalBeatRange(int min, int max);
    void setGlobalChance(double chance);
    void setReverbPower(double power);
    void setReverbChance(double chance);
    void setDelayPower(double power);
    void setDelayChance(double chance);
    void setReversePower(double power);
    void setReverseChance(double chance);
    void setFilterPower(double power);
    void setFilterChance(double chance);
    void setFlangerPower(double power);
    void setFlangerChance(double chance);
    void setTrancePower(double power);
    void setTranceChance(double chance);
    void setShiftPower(double power);
    void setShiftChance(double chance);
    void setRepeatEnabled(bool on);
    // 2^exponent beats, -5..1. min is not above max.
    void setRepeatSizeRange(int min, int max);
    // 2^exponent beats of tail, -4..1.
    void setRepeatLength(int exponent);
    void setRepeatChance(double chance);
    // index is 0..7.
    void setRepeatPosition(int index, bool on);
    void setRepeatMix(double mix);
    // panMin and panMax are -1..1. Each slice's pan roll is scaled onto that range.
    void setOutput(double volume, double panMin, double panMax);
    void setTrack(int index, double start, double length, bool loop, double volume, double pan);
    // mode is 0 none, 1 beat, 2 pitch. bpm is the sample's own tempo, 1..999.9. param is 0..1.
    void setWarp(int index, int mode, double bpm, double param);
    // Factory banks shipped with the plugin. Each entry is a name and a .beatality file name.
    juce::Array<juce::var> factoryBanks() const;
    // Loads a factory pack by its file name. Stops playback.
    bool loadFactory(const juce::String& file);
    // Loads pack text. A missing sample stays in the list with no audio.
    bool loadPackText(const juce::String& text);
    // The current bank, controls, and sequence, as pack text.
    juce::String packText();
    // Empties the current bank. A sounding voice fades out, and the playhead returns to 0.
    bool clearBank();

    double bpm() const { return savedBpm; }
    bool bpmSync() const { return savedBpmSync; }
    int loopBeats() const { return savedLoop; }
    int sliceExponent() const { return savedSlice; }
    int attackMs() const { return savedAttack; }
    bool effectsEnabled() const { return saved.enabled; }
    double globalPower() const { return saved.globalPower; }
    int globalBeatMin() const { return saved.beatMin; }
    int globalBeatMax() const { return saved.beatMax; }
    double globalChance() const { return saved.globalChance; }
    double reverbPower() const { return saved.reverbPower; }
    double reverbChance() const { return saved.reverbChance; }
    double delayPower() const { return saved.delayPower; }
    double delayChance() const { return saved.delayChance; }
    double reversePower() const { return saved.reversePower; }
    double reverseChance() const { return saved.reverseChance; }
    double filterPower() const { return saved.filterPower; }
    double filterChance() const { return saved.filterChance; }
    double flangerPower() const { return saved.flangerPower; }
    double flangerChance() const { return saved.flangerChance; }
    double trancePower() const { return saved.trancePower; }
    double tranceChance() const { return saved.tranceChance; }
    double shiftPower() const { return saved.shiftPower; }
    double shiftChance() const { return saved.shiftChance; }
    const bt::BeatRepeatSettings& beatRepeat() const { return savedRepeat; }
    double outputVolume() const { return savedVolume; }
    double outputPanMin() const { return savedPanMin; }
    double outputPanMax() const { return savedPanMax; }
    double trackStart(int index) const;
    double trackLength(int index) const;
    bool trackLoop(int index) const;
    double trackVolume(int index) const;
    double trackPan(int index) const;
    int trackWarp(int index) const;
    double trackBpm(int index) const;
    double trackWarpParam(int index) const;
    bool trackMissing(int index) const;

    int numTracks() const;
    bool canAppend() const;
    juce::String trackName(int index) const;
    int playTrack() const;
    // Slot inside the loop while a note is held. -1 when nothing is sounding.
    int playSlot() const;
    // 0 at the start of the loop, just under 1 at the end. 0 while stopped.
    double playhead() const;
    double trackRate(int index) const;
    int trackFrames(int index) const;
    const std::vector<float>& trackPeaks(int index) const;
    juce::String errorText() const;

private:
    struct TrackPicture {
        double rate = 0;
        int frames = 0;
        std::vector<float> peaks;
        bool missing = false;
        bool internal = false;
        juce::String address;
        double start = 0;
        double length = 1;
        bool loop = false;
        double volume = 1;
        double pan = 0;
        int warp = 0;
        double bpm = 120;
        double warpParam = 0;
    };

    struct Impl;
    std::unique_ptr<Impl> impl;
    juce::StringArray names;
    std::vector<TrackPicture> pictures;
    juce::String error;
    juce::String savedName = "Pack";
    double savedBpm = 120;
    bool savedBpmSync = false;
    int savedLoop = 8;
    int savedSlice = 0;
    int savedAttack = 2;
    bt::Effects saved;
    bt::BeatRepeatSettings savedRepeat;
    double savedVolume = 1;
    double savedPanMin = 0;
    double savedPanMax = 0;
    std::atomic<std::uint32_t> view{0};
    std::atomic<int> slot{-1};
    std::atomic<double> head{0};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Processor)
};
