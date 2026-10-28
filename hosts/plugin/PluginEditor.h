#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

// The skin from the web widget, hosted in WebView2. Audio stays in the processor.
class Editor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit Editor(Processor&);
    ~Editor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void chooseFiles();
    void deliver(const juce::String& functionName, const juce::var& payload);
    void pushLive();
    void pushBank();
    void noteBank(bool replaced);
    juce::WebBrowserComponent::Options browserOptions();

    Processor& processor;
    std::unique_ptr<juce::WebBrowserComponent> browser;
    std::unique_ptr<juce::FileChooser> chooser;
    juce::Label missing;
    bool pageReady = false;
    int epoch = 0;
    juce::String lastStamp;
    juce::String lastLive;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Editor)
};
