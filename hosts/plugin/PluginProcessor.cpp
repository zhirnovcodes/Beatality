#include "PluginProcessor.h"

#include "PackFile.h"
#include "PluginEditor.h"

#include "BinaryData.h"
#include "NoteGate.h"
#include "SliceEngine.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>

#include <algorithm>
#include <cmath>
#include <functional>
#include <mutex>
#include <optional>
#include <utility>
#include <vector>

namespace {

constexpr int kQueueCapacity = 64;

std::uint32_t packView(int count, int index, bool playing) {
    return static_cast<std::uint32_t>(count) | (static_cast<std::uint32_t>(index + 1) << 8) |
           (playing ? 1u << 16 : 0u);
}

int unpackIndex(std::uint32_t packed) {
    return static_cast<int>((packed >> 8) & 0xffu) - 1;
}

constexpr int kPeakColumns = 512;

// Average of each channel's loudest sample in the column, matching the web waveform.
std::vector<float> peakColumns(const float* left, const float* right, int frames) {
    const int columns = frames > 0 && frames < kPeakColumns ? frames : (frames > 0 ? kPeakColumns : 0);
    std::vector<float> peaks(static_cast<std::size_t>(columns), 0.0f);
    if (left == nullptr || columns <= 0) {
        return peaks;
    }
    for (int column = 0; column < columns; ++column) {
        int start = static_cast<int>((static_cast<long long>(column) * frames) / columns);
        int end = static_cast<int>((static_cast<long long>(column + 1) * frames) / columns);
        if (end <= start) {
            end = start + 1;
        }
        if (start >= frames) {
            continue;
        }
        if (end > frames) {
            end = frames;
        }
        float leftPeak = 0.0f;
        float rightPeak = 0.0f;
        for (int frame = start; frame < end; ++frame) {
            leftPeak = std::max(leftPeak, std::abs(left[frame]));
            if (right != nullptr) {
                rightPeak = std::max(rightPeak, std::abs(right[frame]));
            }
        }
        if (right == nullptr) {
            rightPeak = leftPeak;
        }
        const float average = (leftPeak + rightPeak) * 0.5f;
        peaks[static_cast<std::size_t>(column)] = average > 1.0f ? 1.0f : average;
    }
    return peaks;
}

// What an Ableton Live Clip (.alc) holds: the sample it points at, and the clip's region and tempo.
// start and length are seconds in the sample. bpm is 0 when the clip is not warped.
struct ClipSettings {
    juce::File sample;
    double start = 0;
    double length = 0;
    bool loop = false;
    double bpm = 0;
};

// An .alc is gzipped Live set XML holding one AudioClip. Empty when it can't be read.
std::optional<ClipSettings> readClip(const juce::File& alc) {
    std::unique_ptr<juce::XmlElement> root;
    {
        juce::FileInputStream raw(alc);
        if (!raw.openedOk()) {
            return std::nullopt;
        }
        juce::GZIPDecompressorInputStream unzip(&raw, false, juce::GZIPDecompressorInputStream::gzipFormat);
        root = juce::parseXML(unzip.readEntireStreamAsString());
    }
    if (root == nullptr) {
        root = juce::parseXML(alc);
    }
    if (root == nullptr) {
        return std::nullopt;
    }

    std::function<const juce::XmlElement*(const juce::XmlElement&, const juce::String&)> find =
        [&find](const juce::XmlElement& element, const juce::String& tag) -> const juce::XmlElement* {
        for (const auto* child : element.getChildIterator()) {
            if (child->hasTagName(tag)) {
                return child;
            }
            if (const auto* deeper = find(*child, tag)) {
                return deeper;
            }
        }
        return nullptr;
    };
    const juce::XmlElement* clip = find(*root, "AudioClip");
    if (clip == nullptr) {
        return std::nullopt;
    }
    const auto value = [](const juce::XmlElement* parent, const char* tag) -> juce::String {
        const auto* child = parent != nullptr ? parent->getChildByName(tag) : nullptr;
        return child != nullptr ? child->getStringAttribute("Value") : juce::String();
    };

    ClipSettings settings;
    const auto* sampleRef = clip->getChildByName("SampleRef");
    const auto* fileRef = sampleRef != nullptr ? sampleRef->getChildByName("FileRef") : nullptr;
    // Live 11 and later write the absolute path. The relative one is from the clip's own folder.
    const juce::String path = value(fileRef, "Path");
    const juce::String relative = value(fileRef, "RelativePath");
    if (path.isNotEmpty() && juce::File::isAbsolutePath(path)) {
        settings.sample = juce::File(path);
    }
    if (!settings.sample.existsAsFile() && relative.isNotEmpty()) {
        settings.sample = alc.getParentDirectory().getChildFile(relative);
    }
    if (!settings.sample.existsAsFile()) {
        return std::nullopt;
    }

    // A warped clip counts in beats, and its warp markers map beats to seconds in the sample.
    // An unwarped clip counts in seconds.
    struct Marker {
        double sec;
        double beat;
    };
    std::vector<Marker> markers;
    if (const auto* warpMarkers = clip->getChildByName("WarpMarkers")) {
        for (const auto* marker : warpMarkers->getChildWithTagNameIterator("WarpMarker")) {
            markers.push_back({marker->getDoubleAttribute("SecTime"), marker->getDoubleAttribute("BeatTime")});
        }
    }
    const bool warped = value(clip, "IsWarped") == "true" && markers.size() >= 2;
    const auto seconds = [&](double beat) {
        if (!warped) {
            return beat;
        }
        std::size_t at = 1;
        while (at + 1 < markers.size() && beat > markers[at].beat) {
            ++at;
        }
        const Marker& a = markers[at - 1];
        const Marker& b = markers[at];
        return a.sec + (beat - a.beat) * (b.sec - a.sec) / (b.beat - a.beat);
    };
    if (warped) {
        const Marker& first = markers.front();
        const Marker& last = markers.back();
        settings.bpm = 60.0 * (last.beat - first.beat) / (last.sec - first.sec);
    }

    const auto* loop = clip->getChildByName("Loop");
    settings.loop = value(loop, "LoopOn") == "true";
    const double begin = value(loop, "LoopStart").getDoubleValue();
    // Looped, the clip plays its loop brace. Not looped, it plays from the start marker to the end marker.
    const double end = value(loop, settings.loop ? "LoopEnd" : "OutMarker").getDoubleValue();
    settings.start = std::max(0.0, seconds(begin));
    settings.length = std::max(0.0, seconds(end) - settings.start);
    return settings;
}

struct AppendPayload {
    std::uint32_t id = 0;
    double sourceRate = 0;
    int sourceFrames = 0;
    float* sourceLeft = nullptr;
    float* sourceRight = nullptr;
    int deviceFrames = 0;
    float* deviceLeft = nullptr;
    float* deviceRight = nullptr;
};

void freePayload(AppendPayload* payload) {
    if (payload == nullptr) {
        return;
    }
    delete[] payload->sourceLeft;
    delete[] payload->sourceRight;
    delete[] payload->deviceLeft;
    delete[] payload->deviceRight;
    delete payload;
}

// A mode number outside 0..2 is None. The engine clamps bpm and param.
bt::WarpSettings warpSettings(int mode, double bpm, double param) {
    bt::WarpSettings warp;
    warp.mode = mode >= 0 && mode <= 2 ? static_cast<bt::WarpMode>(mode) : bt::WarpMode::None;
    warp.bpm = bpm;
    warp.param = param;
    return warp;
}

struct PackTrackPayload {
    AppendPayload* audio = nullptr;
    double start = 0;
    double length = 1;
    bool loop = false;
    double volume = 1;
    double pan = 0;
    bt::WarpSettings warp{};
};

struct PackPayload {
    double bpm = 120;
    int loop = 8;
    int slices = 0;
    int attack = 2;
    double volume = 1;
    double panMin = 0;
    double panMax = 0;
    int savedCount = 0;
    std::vector<std::uint16_t> slots;
    std::vector<PackTrackPayload> tracks;
};

void freePack(PackPayload* pack) {
    if (pack == nullptr) {
        return;
    }
    for (PackTrackPayload& track : pack->tracks) {
        freePayload(track.audio);
        track.audio = nullptr;
    }
    delete pack;
}

const char* resourceBytes(const juce::String& filename, int& bytes) {
    for (int i = 0; i < BinaryData::namedResourceListSize; ++i) {
        if (filename.equalsIgnoreCase(BinaryData::originalFilenames[i])) {
            return BinaryData::getNamedResource(BinaryData::namedResourceList[i], bytes);
        }
    }
    bytes = 0;
    return nullptr;
}

struct Stereo {
    int frames = 0;
    std::unique_ptr<float[]> left;
    std::unique_ptr<float[]> right;
};

Stereo resampleStereo(const float* left, const float* right, int frames, double sourceRate, double deviceRate) {
    Stereo out;
    if (left == nullptr || right == nullptr || frames <= 0 || !(sourceRate > 0.0) || !(deviceRate > 0.0)) {
        return out;
    }
    if (std::abs(sourceRate - deviceRate) < 0.5) {
        out.frames = frames;
        out.left = std::make_unique<float[]>(static_cast<std::size_t>(frames));
        out.right = std::make_unique<float[]>(static_cast<std::size_t>(frames));
        std::copy(left, left + frames, out.left.get());
        std::copy(right, right + frames, out.right.get());
        return out;
    }
    const int outFrames = std::max(
        1, static_cast<int>(std::llround(static_cast<double>(frames) * deviceRate / sourceRate)));
    out.frames = outFrames;
    out.left = std::make_unique<float[]>(static_cast<std::size_t>(outFrames));
    out.right = std::make_unique<float[]>(static_cast<std::size_t>(outFrames));
    juce::LagrangeInterpolator leftInterp;
    juce::LagrangeInterpolator rightInterp;
    const double ratio = sourceRate / deviceRate;
    leftInterp.process(ratio, left, out.left.get(), outFrames, frames, 0);
    rightInterp.process(ratio, right, out.right.get(), outFrames, frames, 0);
    return out;
}

AppendPayload* payloadFromReader(juce::AudioFormatReader& reader, double rate, std::uint32_t id) {
    if (reader.lengthInSamples <= 0 || reader.lengthInSamples > 0x7fffffff) {
        return nullptr;
    }
    const int frames = static_cast<int>(reader.lengthInSamples);
    juce::AudioBuffer<float> decoded(std::max(1, static_cast<int>(reader.numChannels)), frames);
    if (!reader.read(&decoded, 0, frames, 0, true, true)) {
        return nullptr;
    }
    const float* left = decoded.getReadPointer(0);
    const float* right = reader.numChannels > 1 ? decoded.getReadPointer(1) : left;
    auto* payload = new AppendPayload;
    payload->id = id;
    payload->sourceRate = reader.sampleRate;
    payload->sourceFrames = frames;
    payload->sourceLeft = new float[static_cast<std::size_t>(frames)];
    payload->sourceRight = new float[static_cast<std::size_t>(frames)];
    std::copy(left, left + frames, payload->sourceLeft);
    std::copy(right, right + frames, payload->sourceRight);
    if (rate > 0.0) {
        auto device = resampleStereo(payload->sourceLeft, payload->sourceRight, frames, payload->sourceRate, rate);
        payload->deviceFrames = device.frames;
        payload->deviceLeft = device.left.release();
        payload->deviceRight = device.right.release();
    }
    return payload;
}

class CommandQueue {
public:
    struct Slot {
        enum class Kind { Randomize, Remove, Append, Clear, Bpm, BpmSync, Attack, RepeatPosition, Track, Warp, Pack };
        Kind kind = Kind::Randomize;
        AppendPayload* append = nullptr;
        PackPayload* pack = nullptr;
        int index = 0;
        int number = 0;
        double first = 0;
        double second = 0;
        double third = 1;
        double fourth = 0;
        bool flag = false;
    };

    bool push(Slot slot) {
        std::lock_guard<std::mutex> lock(mutex);
        const int writeIndex = write.load(std::memory_order_relaxed);
        const int next = (writeIndex + 1) % kQueueCapacity;
        if (next == read.load(std::memory_order_acquire)) {
            return false;
        }
        slots[static_cast<std::size_t>(writeIndex)] = slot;
        write.store(next, std::memory_order_release);
        return true;
    }

    bool pop(Slot& slot) {
        const int readIndex = read.load(std::memory_order_relaxed);
        if (readIndex == write.load(std::memory_order_acquire)) {
            return false;
        }
        slot = slots[static_cast<std::size_t>(readIndex)];
        read.store((readIndex + 1) % kQueueCapacity, std::memory_order_release);
        return true;
    }

    // Holds off push until fn has taken every queued command.
    template <typename Fn>
    void drain(Fn fn) {
        std::lock_guard<std::mutex> lock(mutex);
        Slot slot;
        while (pop(slot)) {
            fn(slot);
        }
    }

    void discard() {
        drain([](Slot slot) {
            freePayload(slot.append);
            freePack(slot.pack);
        });
    }

private:
    Slot slots[kQueueCapacity]{};
    std::atomic<int> read{0};
    std::atomic<int> write{0};
    std::mutex mutex;
};

struct SourceTrack {
    double rate = 0;
    int frames = 0;
    std::unique_ptr<float[]> left;
    std::unique_ptr<float[]> right;
    double start = 0;
    double length = 1;
    bool loop = false;
    double volume = 1;
    double pan = 0;
    bt::WarpSettings warp{};
};

struct DeviceAudio {
    std::uint32_t id = 0;
    int frames = 0;
    std::unique_ptr<float[]> left;
    std::unique_ptr<float[]> right;
};

constexpr float kVolumeMax = 1.2f;

// In bt::ChaosGroup order.
const char* const kChaosGroupIds[bt::ChaosSettings::kGroups] = {"chaosPan",     "chaosSlices",     "chaosAttack",  "chaosRandomize",
                                                               "chaosEffects", "chaosBeatRepeat", "chaosValueOn", "chaosTime"};
const char* const kChaosGroupNames[bt::ChaosSettings::kGroups] = {"Chaos pan",     "Chaos slices",      "Chaos attack",      "Chaos randomize",
                                                                 "Chaos effects", "Chaos beat repeat", "Chaos chaos value", "Chaos time"};

juce::AudioProcessorValueTreeState::ParameterLayout parameterLayout() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"loop", 1}, "Loop", bt::SliceGrid::kMinLoop, bt::SliceGrid::kMaxLoop, 8));
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"slice", 1}, "Slices", bt::SliceGrid::kExpMin, bt::SliceGrid::kExpMax, 0));
    layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID{"randomize", 1}, "Randomize", false));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"volume", 1}, "Volume", juce::NormalisableRange<float>(0.0f, kVolumeMax), 1.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"panMin", 1}, "Pan minimum", juce::NormalisableRange<float>(-1.0f, 1.0f), 0.0f));
    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{"panMax", 1}, "Pan maximum", juce::NormalisableRange<float>(-1.0f, 1.0f), 0.0f));

    // Defaults match bt::Effects and bt::BeatRepeatSettings, which the engine starts with.
    const bt::Effects fx;
    const bt::BeatRepeatSettings repeat;
    const auto unit = [&layout](const char* id, const char* name, double value) {
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{id, 1}, name, juce::NormalisableRange<float>(0.0f, 1.0f),
                                                               static_cast<float>(value)));
    };
    layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID{"effectsOn", 1}, "Effects on", fx.enabled));
    layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID{"shuffle", 1}, "Shuffle", false));
    unit("globalPower", "Global power", fx.globalPower);
    unit("globalChance", "Global chance", fx.globalChance);
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"fxTimeMin", 1}, "Effect time minimum", bt::Effects::kBeatMin,
                                                         bt::Effects::kBeatMax, fx.beatMin));
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"fxTimeMax", 1}, "Effect time maximum", bt::Effects::kBeatMin,
                                                         bt::Effects::kBeatMax, fx.beatMax));
    unit("delayPower", "Delay power", fx.delayPower);
    unit("delayChance", "Delay chance", fx.delayChance);
    unit("reverbPower", "Reverb power", fx.reverbPower);
    unit("reverbChance", "Reverb chance", fx.reverbChance);
    unit("reversePower", "Reverse power", fx.reversePower);
    unit("reverseChance", "Reverse chance", fx.reverseChance);
    unit("filterPower", "Filter power", fx.filterPower);
    unit("filterChance", "Filter chance", fx.filterChance);
    unit("flangerPower", "Flanger power", fx.flangerPower);
    unit("flangerChance", "Flanger chance", fx.flangerChance);
    unit("trancePower", "Trance power", fx.trancePower);
    unit("tranceChance", "Trance chance", fx.tranceChance);
    unit("shiftPower", "Shift power", fx.shiftPower);
    unit("shiftChance", "Shift chance", fx.shiftChance);
    layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID{"repeatOn", 1}, "Beat repeat on", repeat.enabled));
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"repeatSizeMin", 1}, "Size minimum", bt::BeatRepeatSettings::kSizeMin,
                                                         bt::BeatRepeatSettings::kSizeMax, repeat.sizeMin));
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"repeatSizeMax", 1}, "Size maximum", bt::BeatRepeatSettings::kSizeMin,
                                                         bt::BeatRepeatSettings::kSizeMax, repeat.sizeMax));
    unit("repeatMix", "Mix", repeat.mix);
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"repeatLength", 1}, "Length", bt::BeatRepeatSettings::kLengthMin,
                                                         bt::BeatRepeatSettings::kLengthMax, repeat.length));
    unit("repeatChance", "Chance", repeat.chance);

    const bt::ChaosSettings chaos;
    layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID{"chaosTrigger", 1}, "Chaos trigger",
                                                            juce::StringArray{"Randomize button", "Note", "Loop", "Slices", "Beats"},
                                                            static_cast<int>(chaos.trigger)));
    unit("chaosValue", "Chaos value", chaos.value);
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"chaosBeatSize", 1}, "Chaos beat size", bt::ChaosSettings::kBeatSizeMin,
                                                         bt::ChaosSettings::kBeatSizeMax, chaos.beatSize));
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"chaosLoopSize", 1}, "Chaos loop size", bt::ChaosSettings::kLoopSizeMin,
                                                         bt::ChaosSettings::kLoopSizeMax, chaos.loopSize));
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"chaosSliceSize", 1}, "Chaos slice size",
                                                         bt::ChaosSettings::kSliceSizeMin, bt::ChaosSettings::kSliceSizeMax, chaos.sliceSize));
    for (int group = 0; group < bt::ChaosSettings::kGroups; ++group) {
        layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID{kChaosGroupIds[group], 1}, kChaosGroupNames[group],
                                                              chaos.groups[group]));
    }
    return layout;
}

// A change from the plugin window. The gesture lets the host record it as automation.
void setFromWindow(juce::RangedAudioParameter& parameter, float value) {
    parameter.beginChangeGesture();
    parameter.setValueNotifyingHost(parameter.convertTo0to1(value));
    parameter.endChangeGesture();
}

} // namespace

struct Processor::Impl {
    explicit Impl(std::atomic<std::uint32_t>& viewIn, std::atomic<int>& slotIn, std::atomic<double>& headIn)
        : view(viewIn), slot(slotIn), head(headIn) {
        formats.registerBasicFormats();
    }

    void createEngine() {
        engine = std::make_unique<bt::SliceEngine>(rate, seed);
        trackCount = 0;
        playTrack = -1;
        playSlot = -1;
        playing = false;
        playhead = 0;
    }

    void publish() {
        view.store(packView(trackCount, playTrack, playing), std::memory_order_release);
        slot.store(playing ? playSlot : -1, std::memory_order_release);
        head.store(playhead, std::memory_order_release);
    }

    void remember() {
        if (engine == nullptr) {
            return;
        }
        bt::SliceSnapshot snapshot;
        engine->fillSnapshot(snapshot);
        trackCount = snapshot.count;
        playTrack = snapshot.playTrack;
        playSlot = snapshot.playSlot;
        playing = snapshot.playing;
        playhead = snapshot.playhead;
        knobs = engine->controls();
        for (int i = 0; i < snapshot.releasedCount; ++i) {
            const std::uint32_t id = snapshot.released[i];
            std::erase_if(devices, [id](const DeviceAudio& device) { return device.id == id; });
        }
        publish();
        publishSequence();
    }

    void publishSequence() {
        int size = 0;
        int savedCount = 0;
        std::uint16_t slots[bt::Sequence::kMaxSlots]{};
        if (engine != nullptr) {
            size = engine->sequenceSize();
            savedCount = engine->sequenceSavedCount();
            for (int i = 0; i < size; ++i) {
                slots[i] = engine->sequenceSlot(i);
            }
        }
        std::lock_guard<std::mutex> lock(sequenceMirror.mutex);
        sequenceMirror.size = size;
        sequenceMirror.savedCount = savedCount;
        for (int i = 0; i < size; ++i) {
            sequenceMirror.slots[i] = slots[i];
        }
    }

    void storeSequence(const std::vector<std::uint16_t>& slots, int savedCount) {
        std::lock_guard<std::mutex> lock(sequenceMirror.mutex);
        sequenceMirror.size = static_cast<int>(slots.size());
        sequenceMirror.savedCount = savedCount;
        for (int i = 0; i < sequenceMirror.size; ++i) {
            sequenceMirror.slots[i] = slots[static_cast<std::size_t>(i)];
        }
    }

    void copySequence(std::vector<std::uint16_t>& slots, int& savedCount) {
        std::lock_guard<std::mutex> lock(sequenceMirror.mutex);
        savedCount = sequenceMirror.savedCount;
        slots.assign(sequenceMirror.slots, sequenceMirror.slots + sequenceMirror.size);
    }

    void restoreGrid() { engine->apply(knobs); }

    void applyAppend(AppendPayload* payload) {
        if (payload == nullptr) {
            return;
        }
        SourceTrack source;
        source.rate = payload->sourceRate;
        source.frames = payload->sourceFrames;
        source.left.reset(payload->sourceLeft);
        source.right.reset(payload->sourceRight);
        payload->sourceLeft = nullptr;
        payload->sourceRight = nullptr;

        if (payload->deviceLeft == nullptr && rate > 0.0) {
            auto device = resampleStereo(source.left.get(), source.right.get(), source.frames, source.rate, rate);
            payload->deviceFrames = device.frames;
            payload->deviceLeft = device.left.release();
            payload->deviceRight = device.right.release();
        }

        if (engine == nullptr || sources.size() >= static_cast<std::size_t>(bt::SliceEngine::kMaxTracks) ||
            payload->deviceLeft == nullptr || payload->deviceFrames <= 0) {
            freePayload(payload);
            return;
        }

        DeviceAudio device;
        device.id = payload->id;
        device.frames = payload->deviceFrames;
        device.left.reset(payload->deviceLeft);
        device.right.reset(payload->deviceRight);
        payload->deviceLeft = nullptr;
        payload->deviceRight = nullptr;
        delete payload;

        const bt::SampleBuffer buffer{device.id, device.left.get(), device.right.get(), device.frames};
        engine->append(buffer);
        sources.push_back(std::move(source));
        devices.push_back(std::move(device));
        remember();
    }

    void applyRemove(int index) {
        if (index < 0 || index >= static_cast<int>(sources.size())) {
            return;
        }
        sources.erase(sources.begin() + index);
        if (engine != nullptr) {
            engine->remove(index);
            remember();
        }
    }

    void applyClear() {
        sources.clear();
        if (engine == nullptr) {
            return;
        }
        engine->clear();
        remember();
    }

    void applyRandomize() {
        if (captureRandomize) {
            randomizeRequested = true;
        }
        if (engine == nullptr) {
            return;
        }
        // Every trigger mode also rolls chaos on Randomize.
        const bt::Controls before = engine->controls();
        if (engine->count() > 0) {
            engine->randomize();
        }
        engine->triggerChaos();
        if (engine->controls() != before) {
            sendControls();
        }
        remember();
    }

    void applyBpm(double value) {
        ownBpm = value;
        playBpm();
    }

    void applyBpmSync(bool on) {
        bpmSync = on;
        playBpm();
    }

    // Called every block with the host's tempo, or 0 when the host has none.
    void followHost(double value) {
        if (value == hostBpm) {
            return;
        }
        hostBpm = value;
        if (bpmSync) {
            playBpm();
        }
    }

    // The host's tempo while synced and the host has one. Otherwise the plugin's own.
    double playedBpm() const { return bpmSync && hostBpm > 0.0 ? hostBpm : ownBpm; }

    void playBpm() {
        knobs.play.bpm = playedBpm();
        if (engine == nullptr) {
            return;
        }
        engine->apply(knobs);
        remember();
    }

    void applyAttack(int ms) {
        knobs.play.attackMs = ms;
        if (engine == nullptr) {
            return;
        }
        engine->apply(knobs);
        remember();
    }

    void applyRepeatPosition(int index, bool on) {
        knobs.repeat.positions[index] = on;
        if (engine != nullptr) {
            engine->apply(knobs);
        }
    }

    // The knobs that moved since the last block are taken into knobs; the others keep what the engine plays.
    // A host may send min above max; max is held at min.
    void readParams(const bt::Controls& params) {
        const auto take = [](auto& knob, const auto& param, auto& last) {
            if (param != last) {
                knob = param;
                last = param;
            }
        };
        bt::Controls& last = lastParams;
        take(knobs.play.loop, params.play.loop, last.play.loop);
        take(knobs.play.sliceExp, params.play.sliceExp, last.play.sliceExp);
        take(knobs.play.volume, params.play.volume, last.play.volume);
        take(knobs.play.panMin, params.play.panMin, last.play.panMin);
        take(knobs.play.panMax, params.play.panMax, last.play.panMax);
        const bt::Effects& fx = params.effects;
        bt::Effects& fxLast = last.effects;
        bt::Effects& fxKnobs = knobs.effects;
        take(fxKnobs.enabled, fx.enabled, fxLast.enabled);
        take(fxKnobs.globalPower, fx.globalPower, fxLast.globalPower);
        take(fxKnobs.globalChance, fx.globalChance, fxLast.globalChance);
        take(fxKnobs.beatMin, fx.beatMin, fxLast.beatMin);
        take(fxKnobs.beatMax, fx.beatMax, fxLast.beatMax);
        take(fxKnobs.delayPower, fx.delayPower, fxLast.delayPower);
        take(fxKnobs.delayChance, fx.delayChance, fxLast.delayChance);
        take(fxKnobs.reverbPower, fx.reverbPower, fxLast.reverbPower);
        take(fxKnobs.reverbChance, fx.reverbChance, fxLast.reverbChance);
        take(fxKnobs.reversePower, fx.reversePower, fxLast.reversePower);
        take(fxKnobs.reverseChance, fx.reverseChance, fxLast.reverseChance);
        take(fxKnobs.filterPower, fx.filterPower, fxLast.filterPower);
        take(fxKnobs.filterChance, fx.filterChance, fxLast.filterChance);
        take(fxKnobs.flangerPower, fx.flangerPower, fxLast.flangerPower);
        take(fxKnobs.flangerChance, fx.flangerChance, fxLast.flangerChance);
        take(fxKnobs.trancePower, fx.trancePower, fxLast.trancePower);
        take(fxKnobs.tranceChance, fx.tranceChance, fxLast.tranceChance);
        take(fxKnobs.shiftPower, fx.shiftPower, fxLast.shiftPower);
        take(fxKnobs.shiftChance, fx.shiftChance, fxLast.shiftChance);
        const bt::BeatRepeatSettings& repeat = params.repeat;
        bt::BeatRepeatSettings& repeatLast = last.repeat;
        take(knobs.repeat.enabled, repeat.enabled, repeatLast.enabled);
        take(knobs.repeat.sizeMin, repeat.sizeMin, repeatLast.sizeMin);
        take(knobs.repeat.sizeMax, repeat.sizeMax, repeatLast.sizeMax);
        take(knobs.repeat.length, repeat.length, repeatLast.length);
        take(knobs.repeat.chance, repeat.chance, repeatLast.chance);
        take(knobs.repeat.mix, repeat.mix, repeatLast.mix);
        const bt::ChaosSettings& chaos = params.chaos;
        bt::ChaosSettings& chaosLast = last.chaos;
        take(knobs.chaos.trigger, chaos.trigger, chaosLast.trigger);
        take(knobs.chaos.value, chaos.value, chaosLast.value);
        take(knobs.chaos.beatSize, chaos.beatSize, chaosLast.beatSize);
        take(knobs.chaos.loopSize, chaos.loopSize, chaosLast.loopSize);
        take(knobs.chaos.sliceSize, chaos.sliceSize, chaosLast.sliceSize);
        for (int group = 0; group < bt::ChaosSettings::kGroups; ++group) {
            take(knobs.chaos.groups[group], chaos.groups[group], chaosLast.groups[group]);
        }
        knobs.play.panMax = std::max(knobs.play.panMin, knobs.play.panMax);
        fxKnobs.beatMax = std::max(fxKnobs.beatMin, fxKnobs.beatMax);
        knobs.repeat.sizeMax = std::max(knobs.repeat.sizeMin, knobs.repeat.sizeMax);
        engine->apply(knobs);
        knobs = engine->controls();
    }

    // The engine changed its own knobs while it rendered. The newest copy waits here for the message thread.
    void sendControls() {
        std::lock_guard<std::mutex> lock(outbox.mutex);
        outbox.controls = engine->controls();
        outbox.full = true;
    }

    void applyTrack(int index, double start, double length, bool loop, double volume, double pan) {
        if (index >= 0 && index < static_cast<int>(sources.size())) {
            SourceTrack& source = sources[static_cast<std::size_t>(index)];
            source.start = start;
            source.length = length;
            source.loop = loop;
            source.volume = volume;
            source.pan = pan;
        }
        if (engine == nullptr) {
            return;
        }
        engine->setIndexedTrack(index, start, length, loop, volume, pan);
    }

    void applyWarp(int index, const bt::WarpSettings& warp) {
        if (index >= 0 && index < static_cast<int>(sources.size())) {
            sources[static_cast<std::size_t>(index)].warp = warp;
        }
        if (engine == nullptr) {
            return;
        }
        engine->setWarp(index, warp);
    }

    // The track's window, gain, and warp, onto the engine slot that was just appended.
    void placeTrack(int index, const SourceTrack& source) {
        engine->setIndexedTrack(index, source.start, source.length, source.loop, source.volume, source.pan);
        engine->setWarp(index, source.warp);
    }

    void applySlot(CommandQueue::Slot slot) {
        switch (slot.kind) {
        case CommandQueue::Slot::Kind::Randomize:
            applyRandomize();
            break;
        case CommandQueue::Slot::Kind::Remove:
            applyRemove(slot.index);
            break;
        case CommandQueue::Slot::Kind::Append:
            applyAppend(slot.append);
            break;
        case CommandQueue::Slot::Kind::Clear:
            applyClear();
            break;
        case CommandQueue::Slot::Kind::Bpm:
            applyBpm(slot.first);
            break;
        case CommandQueue::Slot::Kind::BpmSync:
            applyBpmSync(slot.flag);
            break;
        case CommandQueue::Slot::Kind::Attack:
            applyAttack(slot.number);
            break;
        case CommandQueue::Slot::Kind::RepeatPosition:
            applyRepeatPosition(slot.index, slot.flag);
            break;
        case CommandQueue::Slot::Kind::Track:
            applyTrack(slot.index, slot.first, slot.second, slot.flag, slot.third, slot.fourth);
            break;
        case CommandQueue::Slot::Kind::Warp:
            applyWarp(slot.index, warpSettings(slot.number, slot.first, slot.second));
            break;
        case CommandQueue::Slot::Kind::Pack:
            applyPack(slot.pack);
            break;
        }
    }

    void applyPack(PackPayload* pack) {
        if (pack == nullptr) {
            return;
        }
        gate = {};
        if (engine != nullptr) {
            engine->stop();
            engine->clear();
        }
        sources.clear();
        ownBpm = pack->bpm;
        knobs.play.bpm = playedBpm();
        knobs.play.loop = pack->loop;
        knobs.play.sliceExp = pack->slices;
        knobs.play.attackMs = pack->attack;
        knobs.play.volume = pack->volume;
        knobs.play.panMin = pack->panMin;
        knobs.play.panMax = pack->panMax;
        if (engine != nullptr) {
            engine->apply(knobs);
        }
        int index = 0;
        for (PackTrackPayload& track : pack->tracks) {
            SourceTrack source;
            source.start = track.start;
            source.length = track.length;
            source.loop = track.loop;
            source.volume = track.volume;
            source.pan = track.pan;
            source.warp = track.warp;
            bool placed = false;
            if (track.audio != nullptr) {
                source.rate = track.audio->sourceRate;
                source.frames = track.audio->sourceFrames;
                source.left.reset(track.audio->sourceLeft);
                source.right.reset(track.audio->sourceRight);
                track.audio->sourceLeft = nullptr;
                track.audio->sourceRight = nullptr;
                if (track.audio->deviceLeft == nullptr && rate > 0.0 && source.frames > 0) {
                    auto resampled = resampleStereo(source.left.get(), source.right.get(), source.frames, source.rate, rate);
                    track.audio->deviceFrames = resampled.frames;
                    track.audio->deviceLeft = resampled.left.release();
                    track.audio->deviceRight = resampled.right.release();
                }
                if (engine != nullptr && track.audio->deviceLeft != nullptr && track.audio->deviceFrames > 0) {
                    DeviceAudio device;
                    device.id = track.audio->id;
                    device.frames = track.audio->deviceFrames;
                    device.left.reset(track.audio->deviceLeft);
                    device.right.reset(track.audio->deviceRight);
                    track.audio->deviceLeft = nullptr;
                    track.audio->deviceRight = nullptr;
                    const bt::SampleBuffer buffer{device.id, device.left.get(), device.right.get(), device.frames};
                    engine->append(buffer);
                    placeTrack(index, source);
                    devices.push_back(std::move(device));
                    placed = true;
                }
                freePayload(track.audio);
                track.audio = nullptr;
            }
            // A missing file, or audio that could not be prepared, still occupies its slot.
            if (engine != nullptr && !placed) {
                const std::uint32_t id = nextId.fetch_add(1, std::memory_order_relaxed);
                const bt::SampleBuffer buffer{id, nullptr, nullptr, 0};
                engine->append(buffer);
                placeTrack(index, source);
            }
            sources.push_back(std::move(source));
            ++index;
        }
        if (engine != nullptr) {
            engine->installSequence(pack->slots.data(), static_cast<int>(pack->slots.size()), pack->savedCount);
        }
        delete pack;
        remember();
    }

    void drain() {
        queue.drain([this](CommandQueue::Slot slot) { applySlot(slot); });
    }

    void startPlayhead() {
        if (engine == nullptr || engine->count() == 0) {
            return;
        }
        engine->play();
        remember();
    }

    void endPlayhead() {
        if (engine == nullptr) {
            return;
        }
        engine->stop();
        remember();
    }

    void applyGate(bt::Gate signal) {
        if (signal == bt::Gate::Start) {
            startPlayhead();
            return;
        }
        if (signal == bt::Gate::Stop) {
            endPlayhead();
        }
    }

    void handleMidi(const juce::MidiMessage& message) {
        if (message.isAllNotesOff() || message.isAllSoundOff()) {
            applyGate(gate.allOff());
            return;
        }
        if (message.isNoteOn()) {
            applyGate(gate.noteOn());
            if (engine->controls().chaos.trigger == bt::ChaosTrigger::Note) {
                engine->triggerChaos();
            }
            return;
        }
        if (message.isNoteOff()) {
            applyGate(gate.noteOff());
        }
    }

    void render(juce::AudioBuffer<float>& buffer, int start, int frames) {
        if (engine == nullptr || frames <= 0) {
            return;
        }
        engine->render(buffer.getWritePointer(0, start), buffer.getWritePointer(1, start), frames);
    }

    void rebuild() {
        // Appends queued before the engine exists still have to land in `sources`.
        if (engine == nullptr && rate > 0.0) {
            createEngine();
        }
        captureRandomize = true;
        randomizeRequested = false;
        drain();
        captureRandomize = false;
        const bool pick = randomizeRequested;

        std::vector<std::uint16_t> keptSlots;
        int keptCount = 0;
        if (engine != nullptr) {
            keptCount = engine->sequenceSavedCount();
            const int keptSize = engine->sequenceSize();
            keptSlots.resize(static_cast<std::size_t>(keptSize));
            for (int i = 0; i < keptSize; ++i) {
                keptSlots[static_cast<std::size_t>(i)] = engine->sequenceSlot(i);
            }
        }

        engine.reset();
        devices.clear();
        if (!(rate > 0.0)) {
            trackCount = 0;
            playTrack = -1;
            playing = false;
            playhead = 0;
            publish();
            return;
        }
        createEngine();
        restoreGrid();
        int index = 0;
        for (const SourceTrack& source : sources) {
            if (source.frames <= 0 || source.left == nullptr || source.right == nullptr) {
                DeviceAudio device;
                device.id = nextId.fetch_add(1, std::memory_order_relaxed);
                const bt::SampleBuffer buffer{device.id, nullptr, nullptr, 0};
                engine->append(buffer);
                placeTrack(index, source);
                devices.push_back(std::move(device));
                ++index;
                continue;
            }
            auto resampled = resampleStereo(source.left.get(), source.right.get(), source.frames, source.rate, rate);
            if (resampled.frames <= 0) {
                continue;
            }
            DeviceAudio device;
            device.id = nextId.fetch_add(1, std::memory_order_relaxed);
            device.frames = resampled.frames;
            device.left = std::move(resampled.left);
            device.right = std::move(resampled.right);
            const bt::SampleBuffer buffer{device.id, device.left.get(), device.right.get(), device.frames};
            engine->append(buffer);
            placeTrack(index, source);
            devices.push_back(std::move(device));
            ++index;
        }
        remember();
        // The new engine has an empty sequence. A randomize that arrived with
        // this rebuild builds one. Otherwise the sequence copied above is put back.
        // A note that is still held starts the playhead.
        if (pick && trackCount > 0) {
            engine->randomize();
        } else if (!keptSlots.empty() && trackCount > 0) {
            engine->installSequence(keptSlots.data(), static_cast<int>(keptSlots.size()), keptCount);
        }
        if (gate.held() > 0 && trackCount > 0) {
            engine->play();
        }
        remember();
    }

    std::atomic<std::uint32_t>& view;
    std::atomic<int>& slot;
    std::atomic<double>& head;
    juce::AudioFormatManager formats;
    CommandQueue queue;
    std::vector<SourceTrack> sources;
    std::vector<DeviceAudio> devices;
    std::unique_ptr<bt::SliceEngine> engine;
    double rate = 0;
    std::atomic<double> publishedRate{0.0};
    std::atomic<std::uint32_t> nextId{1};
    std::uint64_t seed = static_cast<std::uint64_t>(juce::Random::getSystemRandom().nextInt64());
    int trackCount = 0;
    int playTrack = -1;
    int playSlot = -1;
    bool playing = false;
    double playhead = 0;
    bt::NoteGate gate;
    bool captureRandomize = false;
    bool randomizeRequested = false;
    struct SequenceMirror {
        std::mutex mutex;
        int size = 0;
        int savedCount = 0;
        std::uint16_t slots[bt::Sequence::kMaxSlots]{};
    } sequenceMirror;
    // The knobs the engine plays, kept here for an engine that is created later. knobs.play.bpm is the tempo played.
    // ownBpm is the plugin's own; hostBpm is the host's, 0 when it has none.
    bt::Controls knobs;
    double ownBpm = 120;
    double hostBpm = 0;
    bool bpmSync = false;
    // The host parameter values read on the last block. They start at the parameters' defaults.
    bt::Controls lastParams;
    // Knobs the engine changed by itself, for the message thread to write into the host parameters.
    struct ControlsOutbox {
        std::mutex mutex;
        bt::Controls controls;
        bool full = false;
    } outbox;
    // Presses of the shuffle parameter. The processor's timer reads it on the message thread.
    std::atomic<int> shuffles{0};
};

Processor::Processor()
    : juce::AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      params(*this, nullptr, "Parameters", parameterLayout()),
      loopParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("loop"))),
      sliceParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("slice"))),
      volumeParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("volume"))),
      panMinParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("panMin"))),
      panMaxParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("panMax"))),
      effectsOnParam(dynamic_cast<juce::AudioParameterBool*>(params.getParameter("effectsOn"))),
      globalPowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("globalPower"))),
      globalChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("globalChance"))),
      fxTimeMinParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("fxTimeMin"))),
      fxTimeMaxParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("fxTimeMax"))),
      delayPowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("delayPower"))),
      delayChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("delayChance"))),
      reverbPowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("reverbPower"))),
      reverbChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("reverbChance"))),
      reversePowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("reversePower"))),
      reverseChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("reverseChance"))),
      filterPowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("filterPower"))),
      filterChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("filterChance"))),
      flangerPowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("flangerPower"))),
      flangerChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("flangerChance"))),
      trancePowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("trancePower"))),
      tranceChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("tranceChance"))),
      shiftPowerParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("shiftPower"))),
      shiftChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("shiftChance"))),
      repeatOnParam(dynamic_cast<juce::AudioParameterBool*>(params.getParameter("repeatOn"))),
      repeatSizeMinParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("repeatSizeMin"))),
      repeatSizeMaxParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("repeatSizeMax"))),
      repeatMixParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("repeatMix"))),
      repeatLengthParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("repeatLength"))),
      repeatChanceParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("repeatChance"))),
      chaosTriggerParam(dynamic_cast<juce::AudioParameterChoice*>(params.getParameter("chaosTrigger"))),
      chaosValueParam(dynamic_cast<juce::AudioParameterFloat*>(params.getParameter("chaosValue"))),
      chaosBeatSizeParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("chaosBeatSize"))),
      chaosLoopSizeParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("chaosLoopSize"))),
      chaosSliceSizeParam(dynamic_cast<juce::AudioParameterInt*>(params.getParameter("chaosSliceSize"))),
      impl(std::make_unique<Impl>(view, slot, head)) {
    seenPanMin = panMinParam->get();
    seenPanMax = panMaxParam->get();
    seenFxTimeMin = fxTimeMinParam->get();
    seenFxTimeMax = fxTimeMaxParam->get();
    seenSizeMin = repeatSizeMinParam->get();
    seenSizeMax = repeatSizeMaxParam->get();
    for (int group = 0; group < bt::ChaosSettings::kGroups; ++group) {
        chaosGroupParams[group] = dynamic_cast<juce::AudioParameterBool*>(params.getParameter(kChaosGroupIds[group]));
    }
    params.addParameterListener("randomize", this);
    params.addParameterListener("shuffle", this);
    startTimerHz(30);
}

Processor::~Processor() {
    params.removeParameterListener("randomize", this);
    params.removeParameterListener("shuffle", this);
    stopTimer();
    impl->engine.reset();
    impl->queue.discard();
}

void Processor::prepareToPlay(double sampleRate, int) {
    if (!(sampleRate > 0.0)) {
        return;
    }
    const bool sameRate = std::abs(sampleRate - impl->rate) < 0.5 && impl->engine != nullptr;
    impl->rate = sampleRate;
    impl->publishedRate.store(sampleRate, std::memory_order_relaxed);
    if (sameRate) {
        return;
    }
    impl->rebuild();
}

void Processor::releaseResources() {}

void Processor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();
    if (impl->engine == nullptr || buffer.getNumChannels() < 2) {
        return;
    }

    CommandQueue::Slot slot;
    while (impl->queue.pop(slot)) {
        impl->applySlot(slot);
    }
    bt::Controls controls;
    controls.play.loop = loopParam->get();
    controls.play.sliceExp = sliceParam->get();
    controls.play.volume = volumeParam->get();
    controls.play.panMin = panMinParam->get();
    controls.play.panMax = panMaxParam->get();
    controls.effects.enabled = effectsOnParam->get();
    controls.effects.globalPower = globalPowerParam->get();
    controls.effects.beatMin = fxTimeMinParam->get();
    controls.effects.beatMax = fxTimeMaxParam->get();
    controls.effects.globalChance = globalChanceParam->get();
    controls.effects.reverbPower = reverbPowerParam->get();
    controls.effects.reverbChance = reverbChanceParam->get();
    controls.effects.delayPower = delayPowerParam->get();
    controls.effects.delayChance = delayChanceParam->get();
    controls.effects.reversePower = reversePowerParam->get();
    controls.effects.reverseChance = reverseChanceParam->get();
    controls.effects.filterPower = filterPowerParam->get();
    controls.effects.filterChance = filterChanceParam->get();
    controls.effects.flangerPower = flangerPowerParam->get();
    controls.effects.flangerChance = flangerChanceParam->get();
    controls.effects.trancePower = trancePowerParam->get();
    controls.effects.tranceChance = tranceChanceParam->get();
    controls.effects.shiftPower = shiftPowerParam->get();
    controls.effects.shiftChance = shiftChanceParam->get();
    controls.repeat.enabled = repeatOnParam->get();
    controls.repeat.sizeMin = repeatSizeMinParam->get();
    controls.repeat.sizeMax = repeatSizeMaxParam->get();
    controls.repeat.length = repeatLengthParam->get();
    controls.repeat.chance = repeatChanceParam->get();
    controls.repeat.mix = repeatMixParam->get();
    controls.chaos = chaos();
    impl->readParams(controls);
    double hostBpm = 0.0;
    if (juce::AudioPlayHead* playHead = getPlayHead()) {
        if (const auto info = playHead->getPosition()) {
            if (const auto tempo = info->getBpm()) {
                hostBpm = *tempo;
            }
        }
    }
    impl->followHost(hostBpm > 0.0 && std::isfinite(hostBpm) ? hostBpm : 0.0);

    const bt::Controls rendered = impl->engine->controls();
    int position = 0;
    for (const auto metadata : midi) {
        const int at = std::clamp(metadata.samplePosition, 0, buffer.getNumSamples());
        if (at > position) {
            impl->render(buffer, position, at - position);
        }
        position = at;
        impl->handleMidi(metadata.getMessage());
    }
    if (position < buffer.getNumSamples()) {
        impl->render(buffer, position, buffer.getNumSamples() - position);
    }
    if (impl->engine->controls() != rendered) {
        impl->sendControls();
    }
    impl->remember();
}

juce::AudioProcessorEditor* Processor::createEditor() {
    return new Editor(*this);
}

bool Processor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() &&
           layouts.getMainInputChannelSet().isDisabled();
}

void Processor::appendFiles(const juce::Array<juce::File>& files) {
    if (files.isEmpty()) {
        return;
    }
    int added = 0;
    bool skipped = false;
    const double rate = impl->publishedRate.load(std::memory_order_relaxed);
    for (const auto& picked : files) {
        if (!canAppend()) {
            break;
        }
        // A Live clip adds the sample it points at, with the clip's region, loop, and tempo.
        std::optional<ClipSettings> clip;
        juce::File file = picked;
        if (picked.getFileExtension().equalsIgnoreCase(".alc")) {
            clip = readClip(picked);
            if (!clip) {
                skipped = true;
                continue;
            }
            file = clip->sample;
        }
        const auto extension = file.getFileExtension();
        if (!extension.equalsIgnoreCase(".wav") && !extension.equalsIgnoreCase(".mp3")) {
            skipped = true;
            continue;
        }
        std::unique_ptr<juce::AudioFormatReader> reader(impl->formats.createReaderFor(file));
        if (reader == nullptr) {
            skipped = true;
            continue;
        }
        auto* payload = payloadFromReader(*reader, rate, impl->nextId.fetch_add(1, std::memory_order_relaxed));
        if (payload == nullptr) {
            skipped = true;
            continue;
        }
        TrackPicture picture;
        picture.rate = payload->sourceRate;
        picture.frames = payload->sourceFrames;
        picture.peaks = peakColumns(payload->sourceLeft, payload->sourceRight, payload->sourceFrames);
        picture.address = file.getFullPathName();
        // A new file takes the project tempo as its own, so it plays unchanged until its BPM is edited.
        picture.bpm = savedBpm;
        if (clip) {
            // start is a fraction of the file. length is a fraction of what follows the start.
            const double duration = static_cast<double>(picture.frames) / picture.rate;
            const double start = std::min(clip->start, duration);
            picture.start = duration > 0 ? start / duration : 0.0;
            picture.length = duration - start > 0 ? std::clamp(clip->length / (duration - start), 0.0, 1.0) : 1.0;
            picture.loop = clip->loop;
            if (clip->bpm > 0 && std::isfinite(clip->bpm)) {
                picture.bpm = std::clamp(std::round(clip->bpm * 10.0) / 10.0, 1.0, 999.9);
            }
        }
        CommandQueue::Slot slot;
        slot.kind = CommandQueue::Slot::Kind::Append;
        slot.append = payload;
        if (!impl->queue.push(slot)) {
            freePayload(payload);
            break;
        }
        CommandQueue::Slot warp;
        warp.kind = CommandQueue::Slot::Kind::Warp;
        warp.index = names.size();
        warp.number = picture.warp;
        warp.first = picture.bpm;
        warp.second = picture.warpParam;
        impl->queue.push(warp);
        if (clip) {
            CommandQueue::Slot track;
            track.kind = CommandQueue::Slot::Kind::Track;
            track.index = names.size();
            track.first = picture.start;
            track.second = picture.length;
            track.third = picture.volume;
            track.fourth = picture.pan;
            track.flag = picture.loop;
            impl->queue.push(track);
        }
        names.add(file.getFileName());
        pictures.push_back(std::move(picture));
        ++added;
    }
    if (added > 0) {
        error.clear();
    } else if (skipped) {
        error = "Could not read those files.";
    }
}

void Processor::removeTrack(int index) {
    if (index < 0 || index >= names.size()) {
        return;
    }
    CommandQueue::Slot remove;
    remove.kind = CommandQueue::Slot::Kind::Remove;
    remove.index = index;
    if (!impl->queue.push(remove)) {
        return;
    }
    names.remove(index);
    if (index >= 0 && index < static_cast<int>(pictures.size())) {
        pictures.erase(pictures.begin() + static_cast<std::size_t>(index));
    }
    error.clear();
}

void Processor::removeFirstTrack() {
    removeTrack(0);
}

void Processor::randomizeTracks() {
    if (names.isEmpty()) {
        return;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Randomize;
    impl->queue.push(slot);
}

int Processor::numTracks() const {
    return names.size();
}

bool Processor::canAppend() const {
    return names.size() < bt::SliceEngine::kMaxTracks;
}

juce::String Processor::trackName(int index) const {
    if (index < 0 || index >= names.size()) {
        return {};
    }
    return names[index];
}

int Processor::playTrack() const {
    return unpackIndex(view.load(std::memory_order_acquire));
}

int Processor::playSlot() const {
    return slot.load(std::memory_order_acquire);
}

double Processor::playhead() const {
    return head.load(std::memory_order_acquire);
}

bool Processor::clearBank() {
    CommandQueue::Slot clear;
    clear.kind = CommandQueue::Slot::Kind::Clear;
    if (!impl->queue.push(clear)) {
        return false;
    }
    names.clear();
    pictures.clear();
    impl->storeSequence({}, 0);
    error.clear();
    return true;
}

double Processor::trackRate(int index) const {
    if (index < 0 || index >= static_cast<int>(pictures.size())) {
        return 0;
    }
    return pictures[static_cast<std::size_t>(index)].rate;
}

int Processor::trackFrames(int index) const {
    if (index < 0 || index >= static_cast<int>(pictures.size())) {
        return 0;
    }
    return pictures[static_cast<std::size_t>(index)].frames;
}

const std::vector<float>& Processor::trackPeaks(int index) const {
    static const std::vector<float> empty;
    if (index < 0 || index >= static_cast<int>(pictures.size())) {
        return empty;
    }
    return pictures[static_cast<std::size_t>(index)].peaks;
}

void Processor::setBpm(double bpm) {
    if (!(bpm > 0.0) || !std::isfinite(bpm)) {
        return;
    }
    savedBpm = bpm;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Bpm;
    slot.first = bpm;
    impl->queue.push(slot);
}

void Processor::setBpmSync(bool on) {
    savedBpmSync = on;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::BpmSync;
    slot.flag = on;
    impl->queue.push(slot);
}

void Processor::setLoop(int beats) {
    if (beats < bt::SliceGrid::kMinLoop || beats > bt::SliceGrid::kMaxLoop) {
        return;
    }
    setFromWindow(*loopParam, static_cast<float>(beats));
}

void Processor::setSlice(int exponent) {
    if (exponent < bt::SliceGrid::kExpMin || exponent > bt::SliceGrid::kExpMax) {
        return;
    }
    setFromWindow(*sliceParam, static_cast<float>(exponent));
}

void Processor::setAttack(int ms) {
    if (ms < bt::SliceEngine::kAttackMinMs || ms > bt::SliceEngine::kAttackMaxMs) {
        return;
    }
    savedAttack = ms;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Attack;
    slot.number = ms;
    impl->queue.push(slot);
}

void Processor::setEffectsEnabled(bool on) {
    setFromWindow(*effectsOnParam, on ? 1.0f : 0.0f);
}

void Processor::setGlobalPower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*globalPowerParam, static_cast<float>(power));
}

void Processor::setGlobalBeatRange(int min, int max) {
    if (min < bt::Effects::kBeatMin || max > bt::Effects::kBeatMax || min > max) {
        return;
    }
    setFromWindow(*fxTimeMinParam, static_cast<float>(min));
    setFromWindow(*fxTimeMaxParam, static_cast<float>(max));
}

void Processor::setGlobalChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*globalChanceParam, static_cast<float>(chance));
}

void Processor::setReverbPower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*reverbPowerParam, static_cast<float>(power));
}

void Processor::setReverbChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*reverbChanceParam, static_cast<float>(chance));
}

void Processor::setDelayPower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*delayPowerParam, static_cast<float>(power));
}

void Processor::setDelayChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*delayChanceParam, static_cast<float>(chance));
}

void Processor::setReversePower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*reversePowerParam, static_cast<float>(power));
}

void Processor::setReverseChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*reverseChanceParam, static_cast<float>(chance));
}

void Processor::setFilterPower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*filterPowerParam, static_cast<float>(power));
}

void Processor::setFilterChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*filterChanceParam, static_cast<float>(chance));
}

void Processor::setFlangerPower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*flangerPowerParam, static_cast<float>(power));
}

void Processor::setFlangerChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*flangerChanceParam, static_cast<float>(chance));
}

void Processor::setTrancePower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*trancePowerParam, static_cast<float>(power));
}

void Processor::setTranceChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*tranceChanceParam, static_cast<float>(chance));
}

void Processor::setShiftPower(double power) {
    if (!std::isfinite(power) || power < bt::Effects::kPowerMin || power > bt::Effects::kPowerMax) {
        return;
    }
    setFromWindow(*shiftPowerParam, static_cast<float>(power));
}

void Processor::setShiftChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::Effects::kChanceMin || chance > bt::Effects::kChanceMax) {
        return;
    }
    setFromWindow(*shiftChanceParam, static_cast<float>(chance));
}

void Processor::setRepeatEnabled(bool on) {
    setFromWindow(*repeatOnParam, on ? 1.0f : 0.0f);
}

void Processor::setRepeatSizeRange(int min, int max) {
    if (min < bt::BeatRepeatSettings::kSizeMin || max > bt::BeatRepeatSettings::kSizeMax || min > max) {
        return;
    }
    setFromWindow(*repeatSizeMinParam, static_cast<float>(min));
    setFromWindow(*repeatSizeMaxParam, static_cast<float>(max));
}

void Processor::setRepeatLength(int exponent) {
    if (exponent < bt::BeatRepeatSettings::kLengthMin || exponent > bt::BeatRepeatSettings::kLengthMax) {
        return;
    }
    setFromWindow(*repeatLengthParam, static_cast<float>(exponent));
}

void Processor::setRepeatChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::BeatRepeatSettings::kChanceMin || chance > bt::BeatRepeatSettings::kChanceMax) {
        return;
    }
    setFromWindow(*repeatChanceParam, static_cast<float>(chance));
}

void Processor::setRepeatPosition(int index, bool on) {
    if (index < 0 || index >= bt::RepeatSequence::kPositions) {
        return;
    }
    savedPositions[index] = on;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::RepeatPosition;
    slot.index = index;
    slot.flag = on;
    impl->queue.push(slot);
}

void Processor::setRepeatMix(double mix) {
    if (!std::isfinite(mix) || mix < bt::BeatRepeatSettings::kMixMin || mix > bt::BeatRepeatSettings::kMixMax) {
        return;
    }
    setFromWindow(*repeatMixParam, static_cast<float>(mix));
}

void Processor::setEffectsSettings(const bt::Effects& settings) {
    setFromWindow(*effectsOnParam, settings.enabled ? 1.0f : 0.0f);
    setFromWindow(*globalPowerParam, static_cast<float>(settings.globalPower));
    setFromWindow(*globalChanceParam, static_cast<float>(settings.globalChance));
    setFromWindow(*fxTimeMinParam, static_cast<float>(settings.beatMin));
    setFromWindow(*fxTimeMaxParam, static_cast<float>(settings.beatMax));
    setFromWindow(*delayPowerParam, static_cast<float>(settings.delayPower));
    setFromWindow(*delayChanceParam, static_cast<float>(settings.delayChance));
    setFromWindow(*reverbPowerParam, static_cast<float>(settings.reverbPower));
    setFromWindow(*reverbChanceParam, static_cast<float>(settings.reverbChance));
    setFromWindow(*reversePowerParam, static_cast<float>(settings.reversePower));
    setFromWindow(*reverseChanceParam, static_cast<float>(settings.reverseChance));
    setFromWindow(*filterPowerParam, static_cast<float>(settings.filterPower));
    setFromWindow(*filterChanceParam, static_cast<float>(settings.filterChance));
    setFromWindow(*flangerPowerParam, static_cast<float>(settings.flangerPower));
    setFromWindow(*flangerChanceParam, static_cast<float>(settings.flangerChance));
    setFromWindow(*trancePowerParam, static_cast<float>(settings.trancePower));
    setFromWindow(*tranceChanceParam, static_cast<float>(settings.tranceChance));
    setFromWindow(*shiftPowerParam, static_cast<float>(settings.shiftPower));
    setFromWindow(*shiftChanceParam, static_cast<float>(settings.shiftChance));
}

void Processor::shuffleEffects() {
    juce::Random& random = juce::Random::getSystemRandom();
    // 0..1 in steps of 0.01.
    const auto unit = [&random] { return random.nextInt(101) / 100.0; };
    bt::Effects settings;
    settings.enabled = effectsEnabled();
    settings.globalPower = unit();
    settings.globalChance = unit();
    const int span = bt::Effects::kBeatMax - bt::Effects::kBeatMin + 1;
    const int a = bt::Effects::kBeatMin + random.nextInt(span);
    const int b = bt::Effects::kBeatMin + random.nextInt(span);
    settings.beatMin = std::min(a, b);
    settings.beatMax = std::max(a, b);
    settings.delayPower = unit();
    settings.delayChance = unit();
    settings.reverbPower = unit();
    settings.reverbChance = unit();
    settings.reversePower = unit();
    settings.reverseChance = unit();
    settings.filterPower = unit();
    settings.filterChance = unit();
    settings.flangerPower = unit();
    settings.flangerChance = unit();
    settings.trancePower = unit();
    settings.tranceChance = unit();
    settings.shiftPower = unit();
    settings.shiftChance = unit();
    setEffectsSettings(settings);
}

void Processor::parameterChanged(const juce::String& id, float value) {
    if (value < 0.5f) {
        return;
    }
    if (id == "randomize") {
        CommandQueue::Slot slot;
        slot.kind = CommandQueue::Slot::Kind::Randomize;
        impl->queue.push(slot);
        return;
    }
    if (id == "shuffle") {
        impl->shuffles.fetch_add(1, std::memory_order_relaxed);
    }
}

void Processor::receiveControls() {
    bt::Controls controls;
    {
        std::lock_guard<std::mutex> lock(impl->outbox.mutex);
        if (!impl->outbox.full) {
            return;
        }
        controls = impl->outbox.controls;
        impl->outbox.full = false;
    }
    const auto write = [](auto& param, auto value) {
        if (param.get() != value) {
            setFromWindow(param, static_cast<float>(value));
        }
    };
    write(*loopParam, controls.play.loop);
    write(*sliceParam, controls.play.sliceExp);
    write(*volumeParam, static_cast<float>(controls.play.volume));
    write(*panMinParam, static_cast<float>(controls.play.panMin));
    write(*panMaxParam, static_cast<float>(controls.play.panMax));
    const bt::Effects& fx = controls.effects;
    write(*effectsOnParam, fx.enabled);
    write(*globalPowerParam, static_cast<float>(fx.globalPower));
    write(*globalChanceParam, static_cast<float>(fx.globalChance));
    write(*fxTimeMinParam, fx.beatMin);
    write(*fxTimeMaxParam, fx.beatMax);
    write(*delayPowerParam, static_cast<float>(fx.delayPower));
    write(*delayChanceParam, static_cast<float>(fx.delayChance));
    write(*reverbPowerParam, static_cast<float>(fx.reverbPower));
    write(*reverbChanceParam, static_cast<float>(fx.reverbChance));
    write(*reversePowerParam, static_cast<float>(fx.reversePower));
    write(*reverseChanceParam, static_cast<float>(fx.reverseChance));
    write(*filterPowerParam, static_cast<float>(fx.filterPower));
    write(*filterChanceParam, static_cast<float>(fx.filterChance));
    write(*flangerPowerParam, static_cast<float>(fx.flangerPower));
    write(*flangerChanceParam, static_cast<float>(fx.flangerChance));
    write(*trancePowerParam, static_cast<float>(fx.trancePower));
    write(*tranceChanceParam, static_cast<float>(fx.tranceChance));
    write(*shiftPowerParam, static_cast<float>(fx.shiftPower));
    write(*shiftChanceParam, static_cast<float>(fx.shiftChance));
    write(*repeatOnParam, controls.repeat.enabled);
    write(*repeatSizeMinParam, controls.repeat.sizeMin);
    write(*repeatSizeMaxParam, controls.repeat.sizeMax);
    write(*repeatLengthParam, controls.repeat.length);
    write(*repeatChanceParam, static_cast<float>(controls.repeat.chance));
    write(*repeatMixParam, static_cast<float>(controls.repeat.mix));
    write(*chaosValueParam, static_cast<float>(controls.chaos.value));
    write(*chaosBeatSizeParam, controls.chaos.beatSize);
    write(*chaosLoopSizeParam, controls.chaos.loopSize);
    write(*chaosSliceSizeParam, controls.chaos.sliceSize);
    savedAttack = controls.play.attackMs;
    std::copy(std::begin(controls.repeat.positions), std::end(controls.repeat.positions), std::begin(savedPositions));
}

void Processor::timerCallback() {
    receiveControls();
    const int shuffles = shuffleCount();
    if (shuffles != shufflesDone) {
        shufflesDone = shuffles;
        shuffleEffects();
    }
    // An end moved past the other pushes the other along, as the window's sliders do.
    const auto order = [](auto& minParam, auto& maxParam, auto& seenMin, auto& seenMax) {
        const auto min = minParam.get();
        const auto max = maxParam.get();
        if (min > max) {
            if (min != seenMin) {
                setFromWindow(maxParam, static_cast<float>(min));
            } else {
                setFromWindow(minParam, static_cast<float>(max));
            }
        }
        seenMin = minParam.get();
        seenMax = maxParam.get();
    };
    order(*panMinParam, *panMaxParam, seenPanMin, seenPanMax);
    order(*fxTimeMinParam, *fxTimeMaxParam, seenFxTimeMin, seenFxTimeMax);
    order(*repeatSizeMinParam, *repeatSizeMaxParam, seenSizeMin, seenSizeMax);
}

bt::BeatRepeatSettings Processor::beatRepeat() const {
    bt::BeatRepeatSettings repeat;
    repeat.enabled = repeatOnParam->get();
    repeat.sizeMin = repeatSizeMinParam->get();
    repeat.sizeMax = std::max(repeat.sizeMin, repeatSizeMaxParam->get());
    repeat.length = repeatLengthParam->get();
    repeat.chance = repeatChanceParam->get();
    std::copy(std::begin(savedPositions), std::end(savedPositions), std::begin(repeat.positions));
    repeat.mix = repeatMixParam->get();
    return repeat;
}

int Processor::shuffleCount() const {
    return impl->shuffles.load(std::memory_order_relaxed);
}

void Processor::setOutput(double volume, double panMin, double panMax) {
    if (!std::isfinite(volume) || !std::isfinite(panMin) || !std::isfinite(panMax)) {
        return;
    }
    setFromWindow(*volumeParam, static_cast<float>(volume));
    setFromWindow(*panMinParam, static_cast<float>(panMin));
    setFromWindow(*panMaxParam, static_cast<float>(panMax));
}

void Processor::setTrack(int index, double start, double length, bool loop, double volume, double pan) {
    if (index < 0 || index >= names.size() || !std::isfinite(start) || !std::isfinite(length) || !std::isfinite(volume) ||
        !std::isfinite(pan)) {
        return;
    }
    if (index < static_cast<int>(pictures.size())) {
        TrackPicture& picture = pictures[static_cast<std::size_t>(index)];
        picture.start = start;
        picture.length = length;
        picture.loop = loop;
        picture.volume = volume;
        picture.pan = pan;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Track;
    slot.index = index;
    slot.first = start;
    slot.second = length;
    slot.third = volume;
    slot.fourth = pan;
    slot.flag = loop;
    impl->queue.push(slot);
}

void Processor::setWarp(int index, int mode, double bpm, double param) {
    if (index < 0 || index >= names.size() || mode < 0 || mode > 2 || !std::isfinite(bpm) || !std::isfinite(param)) {
        return;
    }
    bpm = std::clamp(std::round(bpm * 10.0) / 10.0, 1.0, 999.9);
    param = std::clamp(param, 0.0, 1.0);
    if (index < static_cast<int>(pictures.size())) {
        TrackPicture& picture = pictures[static_cast<std::size_t>(index)];
        picture.warp = mode;
        picture.bpm = bpm;
        picture.warpParam = param;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Warp;
    slot.index = index;
    slot.number = mode;
    slot.first = bpm;
    slot.second = param;
    impl->queue.push(slot);
}

juce::Array<juce::var> Processor::factoryBanks() const {
    juce::Array<juce::var> list;
    int bytes = 0;
    const char* data = resourceBytes("banks.json", bytes);
    if (data == nullptr || bytes <= 0) {
        return list;
    }
    const auto banks = decodeBanks(juce::String::fromUTF8(data, bytes));
    for (const auto& bank : banks) {
        auto* object = new juce::DynamicObject();
        object->setProperty("name", bank.first);
        object->setProperty("file", bank.second);
        list.add(juce::var(object));
    }
    return list;
}

bool Processor::loadFactory(const juce::String& file) {
    int bytes = 0;
    const char* data = resourceBytes(file, bytes);
    if (data == nullptr || bytes <= 0) {
        error = "Could not read that pack.";
        return false;
    }
    return loadPackText(juce::String::fromUTF8(data, bytes));
}

bool Processor::loadPackText(const juce::String& text) {
    const auto decoded = decodePack(text);
    if (!decoded.has_value()) {
        error = "Could not read that pack.";
        return false;
    }
    const double rate = impl->publishedRate.load(std::memory_order_relaxed);
    auto* payload = new PackPayload;
    payload->bpm = decoded->bpm;
    payload->loop = decoded->loop;
    payload->slices = decoded->slices;
    payload->attack = decoded->attack;
    payload->volume = decoded->volume;
    payload->panMin = decoded->panMin;
    payload->panMax = decoded->panMax;
    payload->savedCount = decoded->savedCount;
    payload->slots = decoded->slots;

    juce::StringArray loaded;
    std::vector<TrackPicture> loadedPictures;
    for (const PackTrack& track : decoded->tracks) {
        PackTrackPayload item;
        item.start = track.start;
        item.length = track.length;
        item.loop = track.loop;
        item.volume = track.volume;
        item.pan = track.pan;
        item.warp = warpSettings(track.warp, track.bpm, track.warpParam);

        TrackPicture picture;
        picture.internal = track.internal;
        picture.address = track.address;
        picture.start = track.start;
        picture.length = track.length;
        picture.loop = track.loop;
        picture.volume = track.volume;
        picture.pan = track.pan;
        picture.warp = track.warp;
        picture.bpm = track.bpm;
        picture.warpParam = track.warpParam;
        picture.missing = true;

        juce::String display = track.internal ? track.address : juce::File(track.address).getFileName();
        if (display.isEmpty()) {
            display = "track";
        }
        std::unique_ptr<juce::AudioFormatReader> reader;
        if (track.internal) {
            int bytes = 0;
            const char* data = resourceBytes(track.address, bytes);
            if (data != nullptr && bytes > 0) {
                auto stream = std::make_unique<juce::MemoryInputStream>(data, static_cast<std::size_t>(bytes), false);
                reader.reset(impl->formats.createReaderFor(std::move(stream)));
            }
        } else if (track.address.isNotEmpty()) {
            reader.reset(impl->formats.createReaderFor(juce::File(track.address)));
        }
        if (reader != nullptr) {
            auto* audio = payloadFromReader(*reader, rate, impl->nextId.fetch_add(1, std::memory_order_relaxed));
            if (audio != nullptr) {
                picture.missing = false;
                picture.rate = audio->sourceRate;
                picture.frames = audio->sourceFrames;
                picture.peaks = peakColumns(audio->sourceLeft, audio->sourceRight, audio->sourceFrames);
                item.audio = audio;
            }
        }
        payload->tracks.push_back(item);
        loaded.add(display);
        loadedPictures.push_back(std::move(picture));
    }

    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Pack;
    slot.pack = payload;
    if (!impl->queue.push(slot)) {
        freePack(payload);
        error = "Could not load that pack.";
        return false;
    }
    names = std::move(loaded);
    pictures = std::move(loadedPictures);
    savedName = decoded->name;
    savedBpm = decoded->bpm;
    savedAttack = decoded->attack;
    // The pack slot sets these on the engine first. The parameters follow; the next block applies the same values again,
    // which leaves the engine and its sequence as they are.
    setFromWindow(*loopParam, static_cast<float>(decoded->loop));
    setFromWindow(*sliceParam, static_cast<float>(decoded->slices));
    setFromWindow(*volumeParam, static_cast<float>(decoded->volume));
    setFromWindow(*panMinParam, static_cast<float>(decoded->panMin));
    setFromWindow(*panMaxParam, static_cast<float>(decoded->panMax));
    impl->storeSequence(decoded->slots, decoded->savedCount);
    error.clear();
    return true;
}

juce::String Processor::packText() {
    PackDocument pack;
    pack.name = savedName;
    pack.bpm = savedBpm;
    pack.loop = loopBeats();
    pack.slices = sliceExponent();
    pack.attack = savedAttack;
    pack.volume = outputVolume();
    pack.panMin = outputPanMin();
    pack.panMax = outputPanMax();
    impl->copySequence(pack.slots, pack.savedCount);
    const int count = std::min(names.size(), static_cast<int>(pictures.size()));
    pack.tracks.reserve(static_cast<std::size_t>(count));
    for (int i = 0; i < count; ++i) {
        const TrackPicture& picture = pictures[static_cast<std::size_t>(i)];
        PackTrack track;
        track.internal = picture.internal;
        track.address = picture.address;
        track.start = picture.start;
        track.length = picture.length;
        track.loop = picture.loop;
        track.volume = picture.volume;
        track.pan = picture.pan;
        track.warp = picture.warp;
        track.bpm = picture.bpm;
        track.warpParam = picture.warpParam;
        pack.tracks.push_back(track);
    }
    return encodePack(pack);
}

double Processor::trackStart(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) ? pictures[static_cast<std::size_t>(index)].start : 0;
}

double Processor::trackLength(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) ? pictures[static_cast<std::size_t>(index)].length : 1;
}

bool Processor::trackLoop(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) && pictures[static_cast<std::size_t>(index)].loop;
}

double Processor::trackVolume(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) ? pictures[static_cast<std::size_t>(index)].volume : 1;
}

double Processor::trackPan(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) ? pictures[static_cast<std::size_t>(index)].pan : 0;
}

int Processor::trackWarp(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) ? pictures[static_cast<std::size_t>(index)].warp : 0;
}

double Processor::trackBpm(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) ? pictures[static_cast<std::size_t>(index)].bpm : 120;
}

double Processor::trackWarpParam(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) ? pictures[static_cast<std::size_t>(index)].warpParam : 0;
}

bool Processor::trackMissing(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) && pictures[static_cast<std::size_t>(index)].missing;
}

juce::String Processor::errorText() const {
    return error;
}

void Processor::setChaosTrigger(int trigger) {
    if (trigger < 0 || trigger > static_cast<int>(bt::ChaosTrigger::Beats)) {
        return;
    }
    setFromWindow(*chaosTriggerParam, static_cast<float>(trigger));
}

void Processor::setChaosValue(double value) {
    if (!std::isfinite(value) || value < 0.0 || value > 1.0) {
        return;
    }
    setFromWindow(*chaosValueParam, static_cast<float>(value));
}

void Processor::setChaosGroup(int group, bool on) {
    if (group < 0 || group >= bt::ChaosSettings::kGroups) {
        return;
    }
    setFromWindow(*chaosGroupParams[group], on ? 1.0f : 0.0f);
}

void Processor::setChaosBeatSize(int exponent) {
    if (exponent < bt::ChaosSettings::kBeatSizeMin || exponent > bt::ChaosSettings::kBeatSizeMax) {
        return;
    }
    setFromWindow(*chaosBeatSizeParam, static_cast<float>(exponent));
}

void Processor::setChaosLoopSize(int loops) {
    if (loops < bt::ChaosSettings::kLoopSizeMin || loops > bt::ChaosSettings::kLoopSizeMax) {
        return;
    }
    setFromWindow(*chaosLoopSizeParam, static_cast<float>(loops));
}

void Processor::setChaosSliceSize(int exponent) {
    if (exponent < bt::ChaosSettings::kSliceSizeMin || exponent > bt::ChaosSettings::kSliceSizeMax) {
        return;
    }
    setFromWindow(*chaosSliceSizeParam, static_cast<float>(exponent));
}

bt::ChaosSettings Processor::chaos() const {
    bt::ChaosSettings chaos;
    chaos.trigger = static_cast<bt::ChaosTrigger>(chaosTriggerParam->getIndex());
    chaos.value = chaosValueParam->get();
    chaos.beatSize = chaosBeatSizeParam->get();
    chaos.loopSize = chaosLoopSizeParam->get();
    chaos.sliceSize = chaosSliceSizeParam->get();
    for (int group = 0; group < bt::ChaosSettings::kGroups; ++group) {
        chaos.groups[group] = chaosGroupParams[group]->get();
    }
    return chaos;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new Processor();
}
