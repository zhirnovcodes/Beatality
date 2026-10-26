#pragma once

#include "PluginProcessor.h"

#include <vector>

class Editor : public juce::AudioProcessorEditor,
               private juce::ListBoxModel,
               private juce::Timer {
public:
    explicit Editor(Processor&);
    ~Editor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    struct TrackEdit {
        double start = 0;
        double length = 1;
        bool loop = false;
    };

    int getNumRows() override;
    void paintListBoxItem(int row, juce::Graphics&, int width, int height, bool selected) override;
    void selectedRowsChanged(int lastRowSelected) override;
    void timerCallback() override;

    void chooseFiles();
    void refresh();
    void adoptTracks();
    void showSelection();
    void refillSlice();
    void commitTrack();

    Processor& processor;
    juce::Label title;
    juce::Label error;
    juce::ListBox list;
    juce::Label startLabel{"", "Start"};
    juce::Slider start;
    juce::Label lengthLabel{"", "Length"};
    juce::Slider length;
    juce::ToggleButton trackLoop{"Loop"};
    juce::Label bpmLabel{"", "BPM"};
    juce::Slider bpm;
    juce::Label loopLabel{"", "Loop"};
    juce::Slider loopBeats;
    juce::Label sliceLabel{"", "Slice"};
    juce::ComboBox slice;
    juce::Label attackLabel{"", "Attack"};
    juce::Slider attack;
    juce::TextButton loadBank{"Load bank"};
    juce::TextButton append{"Append"};
    juce::TextButton remove{"Remove"};
    juce::TextButton randomize{"Randomize"};
    std::unique_ptr<juce::FileChooser> chooser;
    std::vector<TrackEdit> plays;
    int sliceExp = 0;
    int loopSize = 8;
    int shownRow = -1;
    double sentBpm = 120;
    int sentAttack = 2;
    bool writing = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Editor)
};
