#include "PackFile.h"

#include <cmath>

namespace {

double unit(double value) {
    if (value < 0.0) {
        return 0.0;
    }
    if (value > 1.0) {
        return 1.0;
    }
    return value;
}

double clamp(double value, double low, double high) {
    if (value < low) {
        return low;
    }
    if (value > high) {
        return high;
    }
    return value;
}

// In the engine's order: the index is the mode number.
const char* const kWarpNames[] = {"none", "beat", "pitch"};

int warpFromName(const juce::String& name) {
    for (int i = 0; i < 3; ++i) {
        if (name == kWarpNames[i]) {
            return i;
        }
    }
    return 0;
}

bool isNumber(const juce::var& value) {
    return value.isDouble() || value.isInt();
}

// In bt::ChaosTrigger order.
const char* const kChaosTriggerNames[] = {"note", "loop", "slices", "beats", "none"};

double number(juce::DynamicObject& object, const char* key, double fallback, double low, double high) {
    const juce::var value = object.getProperty(key);
    if (!isNumber(value) || !std::isfinite(static_cast<double>(value))) {
        return fallback;
    }
    return clamp(static_cast<double>(value), low, high);
}

int whole(juce::DynamicObject& object, const char* key, int fallback, int low, int high) {
    return static_cast<int>(std::round(number(object, key, fallback, low, high)));
}

bool flag(juce::DynamicObject& object, const char* key, bool fallback) {
    const juce::var value = object.getProperty(key);
    return value.isBool() ? static_cast<bool>(value) : fallback;
}

// Up to count bools from a list. A missing list leaves them.
void flags(const juce::var& value, bool* out, int count) {
    auto* list = value.getArray();
    if (list == nullptr) {
        return;
    }
    for (int i = 0; i < count && i < list->size(); ++i) {
        const juce::var& item = list->getReference(i);
        out[i] = item.isBool() && static_cast<bool>(item);
    }
}

juce::var flagList(const bool* values, int count) {
    juce::Array<juce::var> list;
    for (int i = 0; i < count; ++i) {
        list.add(values[i]);
    }
    return list;
}

// A missing object leaves the defaults.
void decodeEffects(const juce::var& value, bt::Effects& effects) {
    auto* object = value.getDynamicObject();
    if (object == nullptr) {
        return;
    }
    effects.enabled = flag(*object, "enabled", effects.enabled);
    effects.globalPower = number(*object, "globalPower", effects.globalPower, 0, 1);
    effects.globalChance = number(*object, "globalChance", effects.globalChance, 0, 1);
    effects.beatMin = whole(*object, "beatMin", effects.beatMin, bt::Effects::kBeatMin, bt::Effects::kBeatMax);
    effects.beatMax = whole(*object, "beatMax", effects.beatMax, effects.beatMin, bt::Effects::kBeatMax);
    effects.delayPower = number(*object, "delayPower", effects.delayPower, 0, 1);
    effects.delayChance = number(*object, "delayChance", effects.delayChance, 0, 1);
    effects.reverbPower = number(*object, "reverbPower", effects.reverbPower, 0, 1);
    effects.reverbChance = number(*object, "reverbChance", effects.reverbChance, 0, 1);
    effects.reversePower = number(*object, "reversePower", effects.reversePower, 0, 1);
    effects.reverseChance = number(*object, "reverseChance", effects.reverseChance, 0, 1);
    effects.filterPower = number(*object, "filterPower", effects.filterPower, 0, 1);
    effects.filterChance = number(*object, "filterChance", effects.filterChance, 0, 1);
    effects.flangerPower = number(*object, "flangerPower", effects.flangerPower, 0, 1);
    effects.flangerChance = number(*object, "flangerChance", effects.flangerChance, 0, 1);
    effects.trancePower = number(*object, "trancePower", effects.trancePower, 0, 1);
    effects.tranceChance = number(*object, "tranceChance", effects.tranceChance, 0, 1);
    effects.shiftPower = number(*object, "shiftPower", effects.shiftPower, 0, 1);
    effects.shiftChance = number(*object, "shiftChance", effects.shiftChance, 0, 1);
}

void decodeRepeat(const juce::var& value, bt::BeatRepeatSettings& repeat) {
    auto* object = value.getDynamicObject();
    if (object == nullptr) {
        return;
    }
    using Settings = bt::BeatRepeatSettings;
    repeat.enabled = flag(*object, "enabled", repeat.enabled);
    repeat.sizeMin = whole(*object, "sizeMin", repeat.sizeMin, Settings::kSizeMin, Settings::kSizeMax);
    repeat.sizeMax = whole(*object, "sizeMax", repeat.sizeMax, repeat.sizeMin, Settings::kSizeMax);
    repeat.length = whole(*object, "length", repeat.length, Settings::kLengthMin, Settings::kLengthMax);
    repeat.chance = number(*object, "chance", repeat.chance, Settings::kChanceMin, Settings::kChanceMax);
    repeat.mix = number(*object, "mix", repeat.mix, Settings::kMixMin, Settings::kMixMax);
    flags(object->getProperty("positions"), repeat.positions, bt::RepeatSequence::kPositions);
}

void decodeChaos(const juce::var& value, bt::ChaosSettings& chaos) {
    auto* object = value.getDynamicObject();
    if (object == nullptr) {
        return;
    }
    using Settings = bt::ChaosSettings;
    const juce::String trigger = object->getProperty("trigger").toString();
    for (int i = 0; i <= static_cast<int>(bt::ChaosTrigger::None); ++i) {
        if (trigger == kChaosTriggerNames[i]) {
            chaos.trigger = static_cast<bt::ChaosTrigger>(i);
        }
    }
    chaos.value = number(*object, "value", chaos.value, 0, 1);
    chaos.beatSize = whole(*object, "beatSize", chaos.beatSize, Settings::kBeatSizeMin, Settings::kBeatSizeMax);
    chaos.loopSize = whole(*object, "loopSize", chaos.loopSize, Settings::kLoopSizeMin, Settings::kLoopSizeMax);
    chaos.sliceSize = whole(*object, "sliceSize", chaos.sliceSize, Settings::kSliceSizeMin, Settings::kSliceSizeMax);
    flags(object->getProperty("groups"), chaos.groups, Settings::kGroups);
}

juce::var encodeEffects(const bt::Effects& effects) {
    auto* object = new juce::DynamicObject();
    object->setProperty("enabled", effects.enabled);
    object->setProperty("globalPower", effects.globalPower);
    object->setProperty("globalChance", effects.globalChance);
    object->setProperty("beatMin", effects.beatMin);
    object->setProperty("beatMax", effects.beatMax);
    object->setProperty("delayPower", effects.delayPower);
    object->setProperty("delayChance", effects.delayChance);
    object->setProperty("reverbPower", effects.reverbPower);
    object->setProperty("reverbChance", effects.reverbChance);
    object->setProperty("reversePower", effects.reversePower);
    object->setProperty("reverseChance", effects.reverseChance);
    object->setProperty("filterPower", effects.filterPower);
    object->setProperty("filterChance", effects.filterChance);
    object->setProperty("flangerPower", effects.flangerPower);
    object->setProperty("flangerChance", effects.flangerChance);
    object->setProperty("trancePower", effects.trancePower);
    object->setProperty("tranceChance", effects.tranceChance);
    object->setProperty("shiftPower", effects.shiftPower);
    object->setProperty("shiftChance", effects.shiftChance);
    return juce::var(object);
}

juce::var encodeRepeat(const bt::BeatRepeatSettings& repeat) {
    auto* object = new juce::DynamicObject();
    object->setProperty("enabled", repeat.enabled);
    object->setProperty("sizeMin", repeat.sizeMin);
    object->setProperty("sizeMax", repeat.sizeMax);
    object->setProperty("length", repeat.length);
    object->setProperty("chance", repeat.chance);
    object->setProperty("mix", repeat.mix);
    object->setProperty("positions", flagList(repeat.positions, bt::RepeatSequence::kPositions));
    return juce::var(object);
}

juce::var encodeChaos(const bt::ChaosSettings& chaos) {
    auto* object = new juce::DynamicObject();
    object->setProperty("trigger", kChaosTriggerNames[static_cast<int>(chaos.trigger)]);
    object->setProperty("value", chaos.value);
    object->setProperty("beatSize", chaos.beatSize);
    object->setProperty("loopSize", chaos.loopSize);
    object->setProperty("sliceSize", chaos.sliceSize);
    object->setProperty("groups", flagList(chaos.groups, bt::ChaosSettings::kGroups));
    return juce::var(object);
}

int fitSlice(int exponent, int loopBeats) {
    while (std::ldexp(1.0, exponent) > loopBeats) {
        --exponent;
    }
    return exponent;
}

std::optional<PackTrack> decodeTrack(const juce::var& value) {
    auto* object = value.getDynamicObject();
    if (object == nullptr) {
        return std::nullopt;
    }
    const juce::var sourceValue = object->getProperty("source");
    auto* source = sourceValue.getDynamicObject();
    if (source == nullptr) {
        return std::nullopt;
    }
    PackTrack track;
    const juce::String type = source->getProperty("type").toString();
    if (type == "internal") {
        track.internal = true;
        track.address = source->getProperty("id").toString();
    } else if (type == "file") {
        track.internal = false;
        track.address = source->getProperty("path").toString();
    } else {
        return std::nullopt;
    }
    if (track.internal && track.address.isEmpty()) {
        return std::nullopt;
    }
    const juce::var volume = object->getProperty("volume");
    const juce::var start = object->getProperty("start");
    const juce::var pan = object->getProperty("pan");
    const juce::var length = object->getProperty("length");
    const juce::var loop = object->getProperty("loop");
    if ((!volume.isDouble() && !volume.isInt()) || (!start.isDouble() && !start.isInt()) ||
        (!pan.isDouble() && !pan.isInt()) || (!length.isDouble() && !length.isInt()) || !loop.isBool()) {
        return std::nullopt;
    }
    track.volume = clamp(static_cast<double>(volume), 0.0, 1.2);
    track.start = unit(static_cast<double>(start));
    track.pan = clamp(static_cast<double>(pan), -1.0, 1.0);
    track.length = unit(static_cast<double>(length));
    track.loop = static_cast<bool>(loop);
    const juce::var bpm = object->getProperty("bpm");
    const juce::var warpParam = object->getProperty("warpParam");
    track.warp = warpFromName(object->getProperty("warp").toString());
    if (isNumber(bpm) && std::isfinite(static_cast<double>(bpm))) {
        track.bpm = clamp(std::round(static_cast<double>(bpm) * 10.0) / 10.0, 1.0, 999.9);
    }
    if (isNumber(warpParam)) {
        track.warpParam = unit(static_cast<double>(warpParam));
    }
    return track;
}

} // namespace

std::optional<PackDocument> decodePack(const juce::String& text) {
    const juce::var parsed = juce::JSON::parse(text);
    auto* object = parsed.getDynamicObject();
    if (object == nullptr) {
        return std::nullopt;
    }
    if (object->getProperty("format").toString() != "beatality.pack" || static_cast<int>(object->getProperty("version")) != 1) {
        return std::nullopt;
    }
    const double bpm = static_cast<double>(object->getProperty("bpm"));
    const int loop = static_cast<int>(object->getProperty("loop"));
    const int slices = static_cast<int>(object->getProperty("slices"));
    const int attack = static_cast<int>(object->getProperty("attack"));
    if (!(bpm > 0.0) || !std::isfinite(bpm) || loop < 1 || loop > 32 || slices < -4 || slices > 4 || attack < 2 || attack > 16) {
        return std::nullopt;
    }
    const juce::var sequenceValue = object->getProperty("sequence");
    auto* sequence = sequenceValue.getDynamicObject();
    if (sequence == nullptr) {
        return std::nullopt;
    }
    const int savedCount = static_cast<int>(sequence->getProperty("savedCount"));
    const juce::var slotsValue = sequence->getProperty("slots");
    if (savedCount < 0 || !slotsValue.isArray()) {
        return std::nullopt;
    }
    auto* slots = slotsValue.getArray();
    if (slots == nullptr || slots->size() > 2048 || (slots->size() > 0 && savedCount < 1)) {
        return std::nullopt;
    }
    PackDocument pack;
    pack.name = object->getProperty("name").toString();
    if (pack.name.isEmpty()) {
        pack.name = "Pack";
    }
    pack.bpm = clamp(std::round(bpm), 1.0, 999.0);
    pack.loop = loop;
    pack.slices = fitSlice(slices, loop);
    pack.attack = attack;
    pack.volume = clamp(static_cast<double>(object->getProperty("volume")), 0.0, 1.2);
    const double pan = static_cast<double>(object->getProperty("pan"));
    const double panMin = object->hasProperty("panMin") ? static_cast<double>(object->getProperty("panMin")) : pan;
    const double panMax = object->hasProperty("panMax") ? static_cast<double>(object->getProperty("panMax")) : pan;
    pack.panMin = clamp(panMin, -1.0, 1.0);
    pack.panMax = clamp(panMax, pack.panMin, 1.0);
    pack.bpmSync = flag(*object, "bpmSync", pack.bpmSync);
    pack.retrig = flag(*object, "retrig", pack.retrig);
    decodeEffects(object->getProperty("effects"), pack.effects);
    decodeRepeat(object->getProperty("repeat"), pack.repeat);
    decodeChaos(object->getProperty("chaos"), pack.chaos);
    pack.savedCount = savedCount;
    pack.slots.reserve(static_cast<std::size_t>(slots->size()));
    for (const juce::var& slot : *slots) {
        const int index = static_cast<int>(slot);
        if (index < 0 || index >= savedCount) {
            return std::nullopt;
        }
        pack.slots.push_back(static_cast<std::uint16_t>(index));
    }
    const juce::var tracksValue = object->getProperty("tracks");
    if (!tracksValue.isArray()) {
        return std::nullopt;
    }
    auto* tracks = tracksValue.getArray();
    if (tracks == nullptr || tracks->size() > 32) {
        return std::nullopt;
    }
    pack.tracks.reserve(static_cast<std::size_t>(tracks->size()));
    for (const juce::var& item : *tracks) {
        auto track = decodeTrack(item);
        if (!track.has_value()) {
            return std::nullopt;
        }
        pack.tracks.push_back(*track);
    }
    return pack;
}

juce::String encodePack(const PackDocument& pack) {
    auto* object = new juce::DynamicObject();
    object->setProperty("format", "beatality.pack");
    object->setProperty("version", 1);
    object->setProperty("name", pack.name);
    object->setProperty("bpm", pack.bpm);
    object->setProperty("loop", pack.loop);
    object->setProperty("slices", pack.slices);
    object->setProperty("attack", pack.attack);
    object->setProperty("volume", pack.volume);
    object->setProperty("panMin", pack.panMin);
    object->setProperty("panMax", pack.panMax);
    object->setProperty("bpmSync", pack.bpmSync);
    object->setProperty("retrig", pack.retrig);
    object->setProperty("effects", encodeEffects(pack.effects));
    object->setProperty("repeat", encodeRepeat(pack.repeat));
    object->setProperty("chaos", encodeChaos(pack.chaos));

    juce::Array<juce::var> slots;
    for (std::uint16_t slot : pack.slots) {
        slots.add(static_cast<int>(slot));
    }
    auto* sequence = new juce::DynamicObject();
    sequence->setProperty("savedCount", pack.savedCount);
    sequence->setProperty("slots", slots);
    object->setProperty("sequence", juce::var(sequence));

    juce::Array<juce::var> tracks;
    for (const PackTrack& track : pack.tracks) {
        auto* source = new juce::DynamicObject();
        if (track.internal) {
            source->setProperty("type", "internal");
            source->setProperty("id", track.address);
        } else {
            source->setProperty("type", "file");
            source->setProperty("path", track.address);
        }
        auto* item = new juce::DynamicObject();
        item->setProperty("source", juce::var(source));
        item->setProperty("volume", track.volume);
        item->setProperty("start", track.start);
        item->setProperty("pan", track.pan);
        item->setProperty("length", track.length);
        item->setProperty("loop", track.loop);
        item->setProperty("warp", kWarpNames[track.warp >= 0 && track.warp <= 2 ? track.warp : 0]);
        item->setProperty("bpm", track.bpm);
        item->setProperty("warpParam", track.warpParam);
        tracks.add(juce::var(item));
    }
    object->setProperty("tracks", tracks);
    return juce::JSON::toString(juce::var(object));
}

std::vector<std::pair<juce::String, juce::String>> decodeBanks(const juce::String& text) {
    std::vector<std::pair<juce::String, juce::String>> banks;
    const juce::var parsed = juce::JSON::parse(text);
    if (!parsed.isArray()) {
        return banks;
    }
    auto* list = parsed.getArray();
    if (list == nullptr) {
        return banks;
    }
    for (const juce::var& item : *list) {
        auto* object = item.getDynamicObject();
        if (object == nullptr) {
            continue;
        }
        const juce::String name = object->getProperty("name").toString();
        const juce::String file = object->getProperty("file").toString();
        if (name.isNotEmpty() && file.isNotEmpty()) {
            banks.emplace_back(name, file);
        }
    }
    return banks;
}
