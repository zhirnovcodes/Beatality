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
    void setOutput(double volume, double pan);
    void setTrack(int index, double start, double length, bool loop, double volume, double pan);
    // Replaces the track list with the stored Demo bank. Does not move the playhead.
    bool loadBank();
    // Empties the current bank. A sounding voice fades out, and the playhead returns to 0.
    bool clearBank();

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
    };

    struct Impl;
    std::unique_ptr<Impl> impl;
    juce::StringArray names;
    std::vector<TrackPicture> pictures;
    juce::String error;
    std::atomic<std::uint32_t> view{0};
    std::atomic<int> slot{-1};
    std::atomic<double> head{0};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Processor)
};
