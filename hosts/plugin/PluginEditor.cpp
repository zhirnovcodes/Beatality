#include "PluginEditor.h"

#include <algorithm>

namespace {

int wholeBeats(int exponent) {
    return exponent >= 0 ? (1 << exponent) : 0;
}

juce::String sliceText(int exponent) {
    if (exponent >= 0) {
        return juce::String(1 << exponent);
    }
    return "1/" + juce::String(1 << -exponent);
}

// The largest 2^n that is still no longer than the loop.
int fitSlice(int exponent, int beats) {
    while (wholeBeats(exponent) > beats) {
        --exponent;
    }
    return exponent;
}

void styleSlider(juce::Slider& slider, int decimals) {
    slider.setSliderStyle(juce::Slider::LinearHorizontal);
    slider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 56, 20);
    slider.setNumDecimalPlacesToDisplay(decimals);
}

} // namespace

Editor::Editor(Processor& processorIn)
    : juce::AudioProcessorEditor(processorIn), processor(processorIn), list("samples", this) {
    title.setText("Beatality", juce::dontSendNotification);
    title.setFont(juce::Font(juce::FontOptions(22.0f)));
    title.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(title);

    error.setJustificationType(juce::Justification::centredLeft);
    error.setColour(juce::Label::textColourId, juce::Colours::indianred);
    addAndMakeVisible(error);

    list.setRowHeight(22 + SampleBufferView::kHeight);
    list.setMultipleSelectionEnabled(false);
    addAndMakeVisible(sampleBuffer);
    addAndMakeVisible(list);

    for (auto* label : {&startLabel, &lengthLabel, &bpmLabel, &loopLabel, &sliceLabel, &attackLabel, &playheadLabel}) {
        addAndMakeVisible(label);
    }
    styleSlider(start, 3);
    styleSlider(length, 3);
    styleSlider(bpm, 1);
    styleSlider(loopBeats, 0);
    styleSlider(attack, 0);
    playhead.setSliderStyle(juce::Slider::LinearHorizontal);
    playhead.setTextBoxStyle(juce::Slider::NoTextBox, false, 0, 0);
    playhead.setRange(0.0, 1.0, 0.0);
    playhead.setInterceptsMouseClicks(false, false);
    playhead.setColour(juce::Slider::thumbColourId, juce::Colours::red);
    playhead.setColour(juce::Slider::trackColourId, juce::Colours::red);
    start.setRange(0.0, 1.0, 0.001);
    length.setRange(0.0, 1.0, 0.001);
    length.setValue(1.0, juce::dontSendNotification);
    bpm.setRange(1.0, 999.0, 0.1);
    bpm.setValue(sentBpm, juce::dontSendNotification);
    loopBeats.setRange(1.0, 32.0, 1.0);
    loopBeats.setValue(loopSize, juce::dontSendNotification);
    attack.setRange(2.0, 16.0, 1.0);
    attack.setValue(sentAttack, juce::dontSendNotification);
    addAndMakeVisible(start);
    addAndMakeVisible(length);
    addAndMakeVisible(trackLoop);
    addAndMakeVisible(bpm);
    addAndMakeVisible(loopBeats);
    addAndMakeVisible(slice);
    addAndMakeVisible(attack);
    addAndMakeVisible(playhead);

    addAndMakeVisible(loadBank);
    addAndMakeVisible(clear);
    addAndMakeVisible(append);
    addAndMakeVisible(remove);
    addAndMakeVisible(randomize);

    start.onValueChange = [this] {
        if (!writing && !start.isMouseButtonDown()) {
            commitTrack();
        }
    };
    start.onDragEnd = [this] { commitTrack(); };
    length.onValueChange = [this] {
        if (!writing && !length.isMouseButtonDown()) {
            commitTrack();
        }
    };
    length.onDragEnd = [this] { commitTrack(); };
    trackLoop.onClick = [this] { commitTrack(); };
    bpm.onValueChange = [this] {
        if (writing || bpm.isMouseButtonDown()) {
            return;
        }
        const double value = bpm.getValue();
        if (value == sentBpm) {
            return;
        }
        sentBpm = value;
        processor.setBpm(value);
    };
    bpm.onDragEnd = [this] {
        const double value = bpm.getValue();
        if (value == sentBpm) {
            return;
        }
        sentBpm = value;
        processor.setBpm(value);
    };
    loopBeats.onValueChange = [this] {
        if (writing || loopBeats.isMouseButtonDown()) {
            return;
        }
        const int beats = static_cast<int>(loopBeats.getValue());
        if (beats == loopSize) {
            return;
        }
        loopSize = beats;
        sliceExp = fitSlice(sliceExp, loopSize);
        refillSlice();
        processor.setLoop(loopSize);
    };
    loopBeats.onDragEnd = [this] {
        const int beats = static_cast<int>(loopBeats.getValue());
        if (beats == loopSize) {
            return;
        }
        loopSize = beats;
        sliceExp = fitSlice(sliceExp, loopSize);
        refillSlice();
        processor.setLoop(loopSize);
    };
    slice.onChange = [this] {
        if (writing) {
            return;
        }
        const int id = slice.getSelectedId();
        if (id <= 0) {
            return;
        }
        const int exponent = id - 5;
        if (exponent == sliceExp) {
            return;
        }
        sliceExp = exponent;
        processor.setSlice(sliceExp);
    };
    attack.onValueChange = [this] {
        if (writing || attack.isMouseButtonDown()) {
            return;
        }
        const int ms = static_cast<int>(attack.getValue());
        if (ms == sentAttack) {
            return;
        }
        sentAttack = ms;
        processor.setAttack(ms);
    };
    attack.onDragEnd = [this] {
        const int ms = static_cast<int>(attack.getValue());
        if (ms == sentAttack) {
            return;
        }
        sentAttack = ms;
        processor.setAttack(ms);
    };

    append.onClick = [this] { chooseFiles(); };
    remove.onClick = [this] {
        if (processor.numTracks() <= 0) {
            return;
        }
        int index = list.getSelectedRow();
        if (index < 0) {
            index = 0;
        }
        processor.removeTrack(index);
        if (index < static_cast<int>(plays.size())) {
            plays.erase(plays.begin() + static_cast<std::size_t>(index));
        }
        shownRow = -1;
        refresh();
    };
    randomize.onClick = [this] { processor.randomizeTracks(); };
    clear.onClick = [this] {
        if (!processor.clearBank()) {
            return;
        }
        plays.clear();
        shownRow = -1;
        refresh();
    };
    loadBank.onClick = [this] {
        if (!processor.loadBank()) {
            refresh();
            return;
        }
        plays.clear();
        shownRow = -1;
        refresh();
    };

    refillSlice();
    setSize(520, 640);
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
    title.setBounds(area.removeFromTop(28));
    error.setBounds(area.removeFromBottom(22));
    area.removeFromBottom(8);

    auto buttons = area.removeFromBottom(32);
    randomize.setBounds(buttons.removeFromRight(100));
    buttons.removeFromRight(8);
    remove.setBounds(buttons.removeFromRight(84));
    buttons.removeFromRight(8);
    append.setBounds(buttons.removeFromRight(84));
    loadBank.setBounds(buttons.removeFromLeft(100));
    buttons.removeFromLeft(8);
    clear.setBounds(buttons.removeFromLeft(72));

    auto place = [&area](juce::Label& label, juce::Component& control, int labelWidth = 64) {
        area.removeFromBottom(6);
        auto row = area.removeFromBottom(28);
        label.setBounds(row.removeFromLeft(labelWidth));
        control.setBounds(row);
    };
    place(playheadLabel, playhead, 76);
    place(attackLabel, attack);
    place(sliceLabel, slice);
    place(loopLabel, loopBeats);
    place(bpmLabel, bpm);

    area.removeFromBottom(6);
    auto track = area.removeFromBottom(28);
    trackLoop.setBounds(track.removeFromRight(72));
    auto lengthArea = track.removeFromRight(track.getWidth() / 2);
    lengthLabel.setBounds(lengthArea.removeFromLeft(64));
    length.setBounds(lengthArea);
    startLabel.setBounds(track.removeFromLeft(64));
    start.setBounds(track);

    area.removeFromTop(8);
    sampleBuffer.setBounds(area.removeFromTop(80));
    area.removeFromTop(8);
    list.setBounds(area);
}

int Editor::getNumRows() {
    return processor.numTracks();
}

void Editor::paintListBoxItem(int row, juce::Graphics& graphics, int width, int height, bool selected) {
    const bool heard = row == processor.playTrack();
    const auto background = list.findColour(juce::ListBox::backgroundColourId);
    graphics.fillAll(background);
    const int nameHeight = std::min(22, height);
    if (heard) {
        graphics.setColour(background.contrasting(0.25f));
        graphics.fillRect(0, 0, width, nameHeight);
    }
    if (selected) {
        graphics.setColour(list.findColour(juce::ListBox::textColourId));
        graphics.drawRect(0, 0, width, height, 1);
    }
    graphics.setColour(list.findColour(juce::ListBox::textColourId));
    graphics.drawText(processor.trackName(row), 6, 0, width - 12, nameHeight, juce::Justification::centredLeft, true);
    if (height > nameHeight) {
        SampleBufferView::paint(graphics, juce::Rectangle<int>(0, nameHeight, width, height - nameHeight), pictureFor(row));
    }
}

void Editor::selectedRowsChanged(int) {
    showSelection();
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
    adoptTracks();
    if (list.getSelectedRow() >= processor.numTracks()) {
        list.deselectAllRows();
    }
    list.updateContent();
    list.repaint();
    showSelection();
    const bool hasTracks = processor.numTracks() > 0;
    remove.setEnabled(hasTracks);
    clear.setEnabled(hasTracks);
    randomize.setEnabled(hasTracks);
    playhead.setValue(processor.playhead(), juce::dontSendNotification);
    append.setEnabled(processor.canAppend());
    error.setText(processor.errorText(), juce::dontSendNotification);
    sampleBuffer.show(pictureFor(bufferRow()));
}

void Editor::adoptTracks() {
    const int count = processor.numTracks();
    if (static_cast<int>(plays.size()) > count) {
        plays.resize(static_cast<std::size_t>(count));
    }
    while (static_cast<int>(plays.size()) < count) {
        plays.push_back({});
    }
}

void Editor::showSelection() {
    const int row = list.getSelectedRow();
    const bool on = row >= 0 && row < static_cast<int>(plays.size());
    start.setEnabled(on);
    length.setEnabled(on);
    trackLoop.setEnabled(on);
    if (!on) {
        shownRow = -1;
        return;
    }
    if (row == shownRow) {
        return;
    }
    shownRow = row;
    writing = true;
    start.setValue(plays[static_cast<std::size_t>(row)].start, juce::dontSendNotification);
    length.setValue(plays[static_cast<std::size_t>(row)].length, juce::dontSendNotification);
    trackLoop.setToggleState(plays[static_cast<std::size_t>(row)].loop, juce::dontSendNotification);
    writing = false;
}

void Editor::refillSlice() {
    writing = true;
    slice.clear(juce::dontSendNotification);
    for (int exponent = -4; exponent <= 4; ++exponent) {
        if (wholeBeats(exponent) <= loopSize) {
            slice.addItem(sliceText(exponent), exponent + 5);
        }
    }
    slice.setSelectedId(sliceExp + 5, juce::dontSendNotification);
    writing = false;
}

int Editor::bufferRow() const {
    const int selected = list.getSelectedRow();
    if (selected >= 0 && selected < processor.numTracks()) {
        return selected;
    }
    return processor.numTracks() > 0 ? 0 : -1;
}

SampleBufferView::Picture Editor::pictureFor(int row) const {
    SampleBufferView::Picture picture;
    if (row < 0 || row >= processor.numTracks()) {
        return picture;
    }
    picture.hasTrack = true;
    picture.peaks = processor.trackPeaks(row);
    picture.rate = processor.trackRate(row);
    picture.frames = processor.trackFrames(row);
    if (row < static_cast<int>(plays.size())) {
        const auto& play = plays[static_cast<std::size_t>(row)];
        picture.start = play.start;
        picture.length = play.length;
        picture.loop = play.loop;
    }
    picture.bpm = sentBpm;
    picture.loopBeats = loopSize;
    picture.sliceExp = sliceExp;
    if (row == processor.playTrack()) {
        picture.playSlot = processor.playSlot();
    }
    return picture;
}

void Editor::commitTrack() {
    if (writing) {
        return;
    }
    const int row = list.getSelectedRow();
    if (row < 0 || row >= static_cast<int>(plays.size())) {
        return;
    }
    auto& play = plays[static_cast<std::size_t>(row)];
    play.start = start.getValue();
    play.length = length.getValue();
    play.loop = trackLoop.getToggleState();
    processor.setTrack(row, play.start, play.length, play.loop);
}
