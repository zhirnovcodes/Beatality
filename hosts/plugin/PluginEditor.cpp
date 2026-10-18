#include "PluginEditor.h"

Editor::Editor(Processor& processorIn)
    : juce::AudioProcessorEditor(processorIn), processor(processorIn), list("samples", this) {
    title.setText("Beatality", juce::dontSendNotification);
    title.setFont(juce::Font(juce::FontOptions(22.0f)));
    title.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(title);

    error.setJustificationType(juce::Justification::centredLeft);
    error.setColour(juce::Label::textColourId, juce::Colours::indianred);
    addAndMakeVisible(error);

    list.setRowHeight(24);
    addAndMakeVisible(list);

    addAndMakeVisible(append);
    addAndMakeVisible(remove);
    addAndMakeVisible(randomize);
    append.onClick = [this] { chooseFiles(); };
    remove.onClick = [this] {
        processor.removeFirstTrack();
        refresh();
    };
    randomize.onClick = [this] { processor.randomizeTracks(); };

    setSize(420, 520);
    startTimerHz(30);
    refresh();
}

Editor::~Editor() {
    stopTimer();
}

void Editor::paint(juce::Graphics& graphics) {
    graphics.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
}

void Editor::resized() {
    auto area = getLocalBounds().reduced(12);
    title.setBounds(area.removeFromTop(32));
    error.setBounds(area.removeFromBottom(24));
    auto row = area.removeFromBottom(32);
    randomize.setBounds(row.removeFromRight(120));
    row.removeFromRight(8);
    remove.setBounds(row.removeFromRight(120));
    area.removeFromBottom(8);
    append.setBounds(area.removeFromBottom(32).removeFromLeft(120));
    area.removeFromBottom(8);
    list.setBounds(area);
}

int Editor::getNumRows() {
    return processor.numTracks();
}

void Editor::paintListBoxItem(int row, juce::Graphics& graphics, int width, int height, bool) {
    const bool chosen = row == processor.chosenIndex();
    const auto background = list.findColour(juce::ListBox::backgroundColourId);
    graphics.fillAll(chosen ? background.contrasting(0.25f) : background);
    graphics.setColour(list.findColour(juce::ListBox::textColourId));
    const juce::String label = (chosen ? "Chosen: " : "") + processor.trackName(row);
    graphics.drawText(label, 6, 0, width - 12, height, juce::Justification::centredLeft, true);
}

void Editor::timerCallback() {
    refresh();
}

void Editor::chooseFiles() {
    chooser = std::make_unique<juce::FileChooser>("Append samples", juce::File(), "*.wav;*.mp3");
    const auto browserFlags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles |
                              juce::FileBrowserComponent::canSelectMultipleItems;
    juce::Component::SafePointer<Editor> safe(this);
    chooser->launchAsync(browserFlags, [safe](const juce::FileChooser& dialog) {
        if (safe != nullptr) {
            safe->processor.appendFiles(dialog.getResults());
            safe->refresh();
        }
    });
}

void Editor::refresh() {
    list.updateContent();
    list.repaint();
    const bool hasTracks = processor.numTracks() > 0;
    remove.setEnabled(hasTracks);
    randomize.setEnabled(hasTracks);
    append.setEnabled(processor.canAppend());
    error.setText(processor.errorText(), juce::dontSendNotification);
}
