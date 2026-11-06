#pragma once

#include "BeatRepeatSettings.h"
#include "ChaosSettings.h"
#include "Effects.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <vector>

// VST3 and standalone host. The message thread only queues commands.
// The audio thread owns the engine.
class Processor : public juce::AudioProcessor, private juce::Timer, private juce::AudioProcessorValueTreeState::Listener {
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

    // The pack text: controls, sequence, and sample addresses.
    void getStateInformation(juce::MemoryBlock& dest) override;
    void setStateInformation(const void* data, int size) override;

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
    // On, every first note starts the loop at 0. Off, it starts where the project playhead is.
    void setRetrig(bool on);
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
    // Every effect knob at once, onto the host parameters.
    void setEffectsSettings(const bt::Effects& settings);
    // The Shuffle button: a random power and chance for each effect, and a random effect time range.
    void shuffleEffects();
    void setRepeatEnabled(bool on);
    // 2^exponent beats, -5..1. min is not above max.
    void setRepeatSizeRange(int min, int max);
    // 2^exponent beats of tail, -4..1.
    void setRepeatLength(int exponent);
    void setRepeatChance(double chance);
    // index is 0..7.
    void setRepeatPosition(int index, bool on);
    void setRepeatMix(double mix);
    // trigger is a bt::ChaosTrigger. value is 0..1. group is a bt::ChaosGroup.
    // beatSize is -2..1, loopSize is 1..8, sliceSize is -1..2. See bt::ChaosSettings.
    void setChaosTrigger(int trigger);
    void setChaosValue(double value);
    void setChaosGroup(int group, bool on);
    void setChaosBeatSize(int exponent);
    void setChaosLoopSize(int loops);
    void setChaosSliceSize(int exponent);
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
    bool retrig() const { return retrigParam->get(); }
    // Loop, slices, and the output are host parameters. The host's value is the stored one.
    int loopBeats() const { return loopParam->get(); }
    int sliceExponent() const { return sliceParam->get(); }
    int attackMs() const { return savedAttack; }
    // The effects and the beat repeat knobs are host parameters too. Loop parts are not.
    bool effectsEnabled() const { return effectsOnParam->get(); }
    double globalPower() const { return globalPowerParam->get(); }
    int globalBeatMin() const { return fxTimeMinParam->get(); }
    int globalBeatMax() const { return std::max(fxTimeMinParam->get(), fxTimeMaxParam->get()); }
    double globalChance() const { return globalChanceParam->get(); }
    double reverbPower() const { return reverbPowerParam->get(); }
    double reverbChance() const { return reverbChanceParam->get(); }
    double delayPower() const { return delayPowerParam->get(); }
    double delayChance() const { return delayChanceParam->get(); }
    double reversePower() const { return reversePowerParam->get(); }
    double reverseChance() const { return reverseChanceParam->get(); }
    double filterPower() const { return filterPowerParam->get(); }
    double filterChance() const { return filterChanceParam->get(); }
    double flangerPower() const { return flangerPowerParam->get(); }
    double flangerChance() const { return flangerChanceParam->get(); }
    double trancePower() const { return trancePowerParam->get(); }
    double tranceChance() const { return tranceChanceParam->get(); }
    double shiftPower() const { return shiftPowerParam->get(); }
    double shiftChance() const { return shiftChanceParam->get(); }
    bt::BeatRepeatSettings beatRepeat() const;
    // The chaos knobs are host parameters.
    bt::ChaosSettings chaos() const;
    // Counts the times the shuffle parameter switched on.
    int shuffleCount() const;
    double outputVolume() const { return volumeParam->get(); }
    double outputPanMin() const { return panMinParam->get(); }
    double outputPanMax() const { return panMaxParam->get(); }
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

    // Message thread. Shuffles for the shuffle parameter, and keeps each min..max range in order.
    void timerCallback() override;
    // Any thread. Randomize or shuffle switching on is one press.
    void parameterChanged(const juce::String& id, float value) override;
    // Message thread. Writes the knobs the engine changed by itself into the host parameters.
    void receiveControls();

    struct Impl;
    // Ids match the web plugin's parameters.
    // The audio thread reads them each block and applies the ones that changed.
    juce::AudioProcessorValueTreeState params;
    juce::AudioParameterInt* loopParam = nullptr;
    juce::AudioParameterInt* sliceParam = nullptr;
    juce::AudioParameterFloat* volumeParam = nullptr;
    juce::AudioParameterFloat* panMinParam = nullptr;
    juce::AudioParameterFloat* panMaxParam = nullptr;
    juce::AudioParameterBool* effectsOnParam = nullptr;
    juce::AudioParameterFloat* globalPowerParam = nullptr;
    juce::AudioParameterFloat* globalChanceParam = nullptr;
    // Exponents. A host may send min above max; max is held at min.
    juce::AudioParameterInt* fxTimeMinParam = nullptr;
    juce::AudioParameterInt* fxTimeMaxParam = nullptr;
    juce::AudioParameterFloat* delayPowerParam = nullptr;
    juce::AudioParameterFloat* delayChanceParam = nullptr;
    juce::AudioParameterFloat* reverbPowerParam = nullptr;
    juce::AudioParameterFloat* reverbChanceParam = nullptr;
    juce::AudioParameterFloat* reversePowerParam = nullptr;
    juce::AudioParameterFloat* reverseChanceParam = nullptr;
    juce::AudioParameterFloat* filterPowerParam = nullptr;
    juce::AudioParameterFloat* filterChanceParam = nullptr;
    juce::AudioParameterFloat* flangerPowerParam = nullptr;
    juce::AudioParameterFloat* flangerChanceParam = nullptr;
    juce::AudioParameterFloat* trancePowerParam = nullptr;
    juce::AudioParameterFloat* tranceChanceParam = nullptr;
    juce::AudioParameterFloat* shiftPowerParam = nullptr;
    juce::AudioParameterFloat* shiftChanceParam = nullptr;
    juce::AudioParameterBool* repeatOnParam = nullptr;
    juce::AudioParameterInt* repeatSizeMinParam = nullptr;
    juce::AudioParameterInt* repeatSizeMaxParam = nullptr;
    juce::AudioParameterFloat* repeatMixParam = nullptr;
    juce::AudioParameterInt* repeatLengthParam = nullptr;
    juce::AudioParameterFloat* repeatChanceParam = nullptr;
    juce::AudioParameterChoice* chaosTriggerParam = nullptr;
    juce::AudioParameterFloat* chaosValueParam = nullptr;
    juce::AudioParameterInt* chaosBeatSizeParam = nullptr;
    juce::AudioParameterInt* chaosLoopSizeParam = nullptr;
    juce::AudioParameterInt* chaosSliceSizeParam = nullptr;
    // In bt::ChaosGroup order.
    juce::AudioParameterBool* chaosGroupParams[bt::ChaosSettings::kGroups]{};
    juce::AudioParameterBool* retrigParam = nullptr;
    std::unique_ptr<Impl> impl;
    juce::StringArray names;
    std::vector<TrackPicture> pictures;
    juce::String error;
    juce::String savedName = "Pack";
    double savedBpm = 120;
    bool savedBpmSync = false;
    int savedAttack = 2;
    // The loop parts. The other beat repeat knobs are host parameters.
    bool savedPositions[bt::RepeatSequence::kPositions]{};
    // The shuffle count last handled.
    int shufflesDone = 0;
    // The range ends the timer last saw. The end that moved since is the one the host or MIDI sent.
    float seenPanMin = 0;
    float seenPanMax = 0;
    int seenFxTimeMin = 0;
    int seenFxTimeMax = 0;
    int seenSizeMin = 0;
    int seenSizeMax = 0;
    std::atomic<std::uint32_t> view{0};
    std::atomic<int> slot{-1};
    std::atomic<double> head{0};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Processor)
};
