#pragma once

#include <juce_core/juce_core.h>

#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

// One .beatality document. Addresses only: a bundled file name, or a path on disk.
struct PackTrack {
    bool internal = false;
    juce::String address;
    double start = 0;
    double length = 1;
    bool loop = false;
    double volume = 1;
    double pan = 0;
};

struct PackDocument {
    juce::String name = "Pack";
    double bpm = 120;
    int loop = 8;
    int slices = 0;
    int attack = 2;
    double volume = 1;
    double pan = 0;
    int savedCount = 0;
    std::vector<std::uint16_t> slots;
    std::vector<PackTrack> tracks;
};

std::optional<PackDocument> decodePack(const juce::String& text);
juce::String encodePack(const PackDocument& pack);
std::vector<std::pair<juce::String, juce::String>> decodeBanks(const juce::String& text);
