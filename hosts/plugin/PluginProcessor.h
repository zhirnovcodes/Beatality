#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <cstdint>

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

    // Message thread.
    void appendFiles(const juce::Array<juce::File>& files);
    void removeFirstTrack();
    void randomizeTracks();

    int numTracks() const;
    bool canAppend() const;
    juce::String trackName(int index) const;
    int chosenIndex() const;
    juce::String errorText() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
    juce::StringArray names;
    juce::String error;
    std::atomic<std::uint32_t> view{0};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Processor)
};
