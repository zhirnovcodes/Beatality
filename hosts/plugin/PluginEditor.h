#pragma once

#include "PluginProcessor.h"

class Editor : public juce::AudioProcessorEditor,
               private juce::ListBoxModel,
               private juce::Timer {
public:
    explicit Editor(Processor&);
    ~Editor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    int getNumRows() override;
    void paintListBoxItem(int row, juce::Graphics&, int width, int height, bool selected) override;
    void timerCallback() override;

    void chooseFiles();
    void refresh();

    Processor& processor;
    juce::Label title;
    juce::Label error;
    juce::ListBox list;
    juce::TextButton append{"Append"};
    juce::TextButton remove{"Remove"};
    juce::TextButton randomize{"Randomize"};
    std::unique_ptr<juce::FileChooser> chooser;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Editor)
};
