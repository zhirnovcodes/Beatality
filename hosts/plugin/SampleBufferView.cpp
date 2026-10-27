#include "SampleBufferView.h"

#include <algorithm>
#include <cmath>

namespace {

double beatsOfExp(int exponent) { return std::ldexp(1.0, exponent); }

int slicesIn(double durationSec, double sliceSec) {
    if (!(sliceSec > 0.0)) {
        return 1;
    }
    const double count = std::floor(durationSec / sliceSec + 0.99);
    return count < 1.0 ? 1 : static_cast<int>(count);
}

int countSlots(int loopBeats, int exponent) {
    if (exponent >= 0) {
        const int size = 1 << exponent;
        return size > 0 ? loopBeats / size : 0;
    }
    return loopBeats * (1 << -exponent);
}

} // namespace

void SampleBufferView::show(Picture picture) {
    shown = std::move(picture);
    repaint();
}

void SampleBufferView::paint(juce::Graphics& graphics) {
    paint(graphics, getLocalBounds(), shown);
}

void SampleBufferView::paint(juce::Graphics& graphics, juce::Rectangle<int> bounds, const Picture& picture) {
    graphics.setColour(juce::Colours::white);
    graphics.fillRect(bounds);
    if (bounds.getWidth() <= kOffset || bounds.getHeight() <= 0) {
        graphics.setColour(juce::Colours::black);
        graphics.drawRect(bounds);
        return;
    }

    const int loopWidth = std::max(1, bounds.getWidth() - kOffset);
    const auto frame = juce::Rectangle<int>(bounds.getX() + kOffset, bounds.getY(), loopWidth, bounds.getHeight());
    if (!picture.hasTrack) {
        graphics.setColour(juce::Colours::black);
        graphics.drawRect(frame, 1);
        return;
    }

    const double bpmValue = picture.bpm > 0.0 ? picture.bpm : 120.0;
    const int beats = std::max(1, picture.loopBeats);
    const double sliceBeats = beatsOfExp(picture.sliceExp);
    const double pxPerBeat = static_cast<double>(loopWidth) / static_cast<double>(beats);
    const double gridWidth = sliceBeats * pxPerBeat;
    const double durationSec = picture.rate > 0.0 && picture.frames > 0 ? static_cast<double>(picture.frames) / picture.rate : 0.0;
    const double imageWidth = durationSec * (bpmValue / 60.0) * pxPerBeat;
    const double imageStart = static_cast<double>(kOffset) - picture.start * imageWidth;
    const double sliceSec = (sliceBeats * 60.0) / bpmValue;
    const double usableSec = durationSec * (1.0 - picture.start);
    const int maxSlices = slicesIn(usableSec, sliceSec);
    const double length = std::clamp(picture.length, 0.0, 1.0);
    const int sliceCount = static_cast<int>(std::llround(length * static_cast<double>(maxSlices - 1))) + 1;
    const double contentWidth = sliceCount * gridWidth;
    const double lead = std::max(0.0, static_cast<double>(kOffset) - imageStart);
    const double audioAfter = std::max(0.0, imageWidth - lead);
    const double drawWidth = std::min(std::max(0.0, contentWidth), audioAfter);

    graphics.saveState();
    graphics.reduceClipRegion(frame);

    const int columns = static_cast<int>(picture.peaks.size());
    if (columns > 0 && imageWidth > 0.0 && drawWidth > 0.0) {
        graphics.setColour(juce::Colour(0xffc1fd31));
        const float mid = static_cast<float>(bounds.getY()) + static_cast<float>(bounds.getHeight()) * 0.5f;
        const float half = static_cast<float>(bounds.getHeight()) * 0.5f;
        for (int x = frame.getX(); x < frame.getRight(); ++x) {
            const double local = static_cast<double>(x - bounds.getX()) - static_cast<double>(kOffset);
            double into = local;
            if (picture.loop && contentWidth > 0.0) {
                into = std::fmod(local, contentWidth);
                if (into < 0.0) {
                    into += contentWidth;
                }
            }
            if (into < 0.0 || into >= drawWidth) {
                continue;
            }
            const double sourceCss = lead + into;
            const int column = static_cast<int>((sourceCss / imageWidth) * static_cast<double>(columns));
            if (column < 0 || column >= columns) {
                continue;
            }
            const float bar = std::max(picture.peaks[static_cast<std::size_t>(column)] * half, 0.5f);
            graphics.fillRect(static_cast<float>(x), mid - bar, 1.0f, bar * 2.0f);
        }
    }

    const int slots = countSlots(beats, picture.sliceExp);
    if (picture.playSlot >= 0 && picture.playSlot < slots && gridWidth > 0.0) {
        graphics.setColour(juce::Colour(0xffb0bcf2).withAlpha(0.55f));
        graphics.fillRect(static_cast<float>(frame.getX()) + static_cast<float>(picture.playSlot) * static_cast<float>(gridWidth),
                          static_cast<float>(frame.getY()), static_cast<float>(gridWidth),
                          static_cast<float>(frame.getHeight()));
    }

    if (gridWidth > 0.0) {
        graphics.setColour(juce::Colours::black);
        int guard = 0;
        for (double x = 0.0; x < static_cast<double>(loopWidth) && guard < 4096; x += gridWidth, ++guard) {
            const int px = frame.getX() + static_cast<int>(std::lround(x));
            if (px >= frame.getRight()) {
                break;
            }
            graphics.fillRect(px, frame.getY(), 1, frame.getHeight());
        }
    }

    graphics.restoreState();
    graphics.setColour(juce::Colours::black);
    graphics.drawRect(frame, 1);
}
