#pragma once

#include "BeatRepeatSettings.h"
#include "ChaosSettings.h"
#include "Effects.h"

#include <juce_core/juce_core.h>

#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

// One .beatality document. Addresses only: a bundled file name, or a path on disk.
// warp is the engine's mode number: 0 none, 1 beat, 2 pitch, 3 grain. The file stores it by name.
// bpm is the sample's own tempo, 1.0..999.9. Packs without the warp fields read as none, 120, and 0.
struct PackTrack {
    bool internal = false;
    juce::String address;
    double start = 0;
    double length = 1;
    bool loop = false;
    double volume = 1;
    double pan = 0;
    int warp = 0;
    double bpm = 120;
    double warpParam = 0;
};

struct PackDocument {
    juce::String name = "Pack";
    double bpm = 120;
    int loop = 8;
    int slices = 0;
    int attack = 2;
    double volume = 1;
    // Each slice's pan roll is scaled onto panMin..panMax. Older packs have one pan, read as both.
    double panMin = 0;
    double panMax = 0;
    // Packs without these read as the engine defaults, sync off, and retrig on.
    bool bpmSync = false;
    bool retrig = true;
    bt::Effects effects;
    bt::BeatRepeatSettings repeat;
    bt::ChaosSettings chaos;
    int savedCount = 0;
    std::vector<std::uint16_t> slots;
    std::vector<PackTrack> tracks;
};

std::optional<PackDocument> decodePack(const juce::String& text);
juce::String encodePack(const PackDocument& pack);
std::vector<std::pair<juce::String, juce::String>> decodeBanks(const juce::String& text);
