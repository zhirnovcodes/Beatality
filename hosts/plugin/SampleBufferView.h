#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <vector>

// One track strip: waveform, slice lines, and the slice that is playing.
class SampleBufferView : public juce::Component {
public:
    static constexpr int kHeight = 80;
    static constexpr int kOffset = 20;

    struct Picture {
        bool hasTrack = false;
        std::vector<float> peaks;
        double rate = 0;
        int frames = 0;
        double start = 0;
        double length = 1;
        bool loop = false;
        double bpm = 120;
        int loopBeats = 8;
        int sliceExp = 0;
        int playSlot = -1;
    };

    SampleBufferView() = default;

    void show(Picture picture);

    void paint(juce::Graphics&) override;

    static void paint(juce::Graphics&, juce::Rectangle<int> bounds, const Picture& picture);

private:
    Picture shown;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SampleBufferView)
};
