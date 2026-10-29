#pragma once

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
    void setLoop(int beats);
    void setSlice(int exponent);
    void setAttack(int ms);
    void setGlobalPower(double power);
    void setGlobalBeat(int exponent);
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
    void setOutput(double volume, double pan);
    void setTrack(int index, double start, double length, bool loop, double volume, double pan);
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
    int loopBeats() const { return savedLoop; }
    int sliceExponent() const { return savedSlice; }
    int attackMs() const { return savedAttack; }
    double globalPower() const { return savedGlobalPower; }
    int globalBeat() const { return savedGlobalBeat; }
    double globalChance() const { return savedGlobalChance; }
    double reverbPower() const { return savedReverbPower; }
    double reverbChance() const { return savedReverbChance; }
    double delayPower() const { return savedDelayPower; }
    double delayChance() const { return savedDelayChance; }
    double reversePower() const { return savedReversePower; }
    double reverseChance() const { return savedReverseChance; }
    double filterPower() const { return savedFilterPower; }
    double filterChance() const { return savedFilterChance; }
    double flangerPower() const { return savedFlangerPower; }
    double flangerChance() const { return savedFlangerChance; }
    double trancePower() const { return savedTrancePower; }
    double tranceChance() const { return savedTranceChance; }
    double outputVolume() const { return savedVolume; }
    double outputPan() const { return savedPan; }
    double trackStart(int index) const;
    double trackLength(int index) const;
    bool trackLoop(int index) const;
    double trackVolume(int index) const;
    double trackPan(int index) const;
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
    };

    struct Impl;
    std::unique_ptr<Impl> impl;
    juce::StringArray names;
    std::vector<TrackPicture> pictures;
    juce::String error;
    juce::String savedName = "Pack";
    double savedBpm = 120;
    int savedLoop = 8;
    int savedSlice = 0;
    int savedAttack = 2;
    double savedGlobalPower = 1;
    int savedGlobalBeat = 0;
    double savedGlobalChance = 0;
    double savedReverbPower = 1;
    double savedReverbChance = 0;
    double savedDelayPower = 1;
    double savedDelayChance = 0;
    double savedReversePower = 1;
    double savedReverseChance = 0;
    double savedFilterPower = 1;
    double savedFilterChance = 0;
    double savedFlangerPower = 1;
    double savedFlangerChance = 0;
    double savedTrancePower = 1;
    double savedTranceChance = 0;
    double savedVolume = 1;
    double savedPan = 0;
    std::atomic<std::uint32_t> view{0};
    std::atomic<int> slot{-1};
    std::atomic<double> head{0};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Processor)
};
