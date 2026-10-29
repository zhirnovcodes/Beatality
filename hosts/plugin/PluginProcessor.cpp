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
#include <mutex>
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

struct PackTrackPayload {
    AppendPayload* audio = nullptr;
    double start = 0;
    double length = 1;
    bool loop = false;
    double volume = 1;
    double pan = 0;
};

struct PackPayload {
    double bpm = 120;
    int loop = 8;
    int slices = 0;
    int attack = 2;
    double volume = 1;
    double pan = 0;
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
        enum class Kind { Randomize, Remove, Append, Clear, Bpm, Loop, Slice, Attack, GlobalPower, GlobalBeat, GlobalChance, ReverbPower, ReverbChance, DelayPower, DelayChance, ReversePower, ReverseChance, FilterPower, FilterChance, FlangerPower, FlangerChance, TrancePower, TranceChance, Track, Output, Pack };
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
};

struct DeviceAudio {
    std::uint32_t id = 0;
    int frames = 0;
    std::unique_ptr<float[]> left;
    std::unique_ptr<float[]> right;
};

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
        bpm = snapshot.bpm;
        loopBeats = snapshot.loopBeats;
        sliceExp = snapshot.sliceExp;
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

    void restoreGrid() {
        engine->setBpm(bpm);
        engine->setLoop(loopBeats);
        engine->setSlice(sliceExp);
        engine->setAttack(attackMs);
        engine->setGlobalPower(globalPower);
        engine->setGlobalBeat(globalBeatExp);
        engine->setGlobalChance(globalChance);
        engine->setReverbPower(reverbPower);
        engine->setReverbChance(reverbChance);
        engine->setDelayPower(delayPower);
        engine->setDelayChance(delayChance);
        engine->setReversePower(reversePower);
        engine->setReverseChance(reverseChance);
        engine->setFilterPower(filterPower);
        engine->setFilterChance(filterChance);
        engine->setFlangerPower(flangerPower);
        engine->setFlangerChance(flangerChance);
        engine->setTrancePower(trancePower);
        engine->setTranceChance(tranceChance);
        engine->setOutput(outputVolume, outputPan);
    }

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
        if (engine == nullptr || engine->count() == 0) {
            return;
        }
        engine->randomize();
        remember();
    }

    void applyBpm(double value) {
        if (engine == nullptr) {
            bpm = value;
            return;
        }
        engine->setBpm(value);
        remember();
    }

    void applyLoop(int beats) {
        if (engine == nullptr) {
            loopBeats = beats;
            return;
        }
        engine->setLoop(beats);
        remember();
    }

    void applySlice(int exponent) {
        if (engine == nullptr) {
            sliceExp = exponent;
            return;
        }
        engine->setSlice(exponent);
        remember();
    }

    void applyAttack(int ms) {
        attackMs = ms;
        if (engine == nullptr) {
            return;
        }
        engine->setAttack(ms);
        remember();
    }

    void applyGlobalPower(double power) {
        globalPower = power;
        if (engine == nullptr) {
            return;
        }
        engine->setGlobalPower(power);
    }

    void applyGlobalBeat(int exponent) {
        globalBeatExp = exponent;
        if (engine == nullptr) {
            return;
        }
        engine->setGlobalBeat(exponent);
    }

    void applyGlobalChance(double chance) {
        globalChance = chance;
        if (engine == nullptr) {
            return;
        }
        engine->setGlobalChance(chance);
    }

    void applyReverbPower(double power) {
        reverbPower = power;
        if (engine == nullptr) {
            return;
        }
        engine->setReverbPower(power);
    }

    void applyReverbChance(double chance) {
        reverbChance = chance;
        if (engine == nullptr) {
            return;
        }
        engine->setReverbChance(chance);
    }

    void applyDelayPower(double power) {
        delayPower = power;
        if (engine == nullptr) {
            return;
        }
        engine->setDelayPower(power);
    }

    void applyDelayChance(double chance) {
        delayChance = chance;
        if (engine == nullptr) {
            return;
        }
        engine->setDelayChance(chance);
    }

    void applyReversePower(double power) {
        reversePower = power;
        if (engine == nullptr) {
            return;
        }
        engine->setReversePower(power);
    }

    void applyReverseChance(double chance) {
        reverseChance = chance;
        if (engine == nullptr) {
            return;
        }
        engine->setReverseChance(chance);
    }

    void applyFilterPower(double power) {
        filterPower = power;
        if (engine == nullptr) {
            return;
        }
        engine->setFilterPower(power);
    }

    void applyFilterChance(double chance) {
        filterChance = chance;
        if (engine == nullptr) {
            return;
        }
        engine->setFilterChance(chance);
    }

    void applyFlangerPower(double power) {
        flangerPower = power;
        if (engine == nullptr) {
            return;
        }
        engine->setFlangerPower(power);
    }

    void applyFlangerChance(double chance) {
        flangerChance = chance;
        if (engine == nullptr) {
            return;
        }
        engine->setFlangerChance(chance);
    }

    void applyTrancePower(double power) {
        trancePower = power;
        if (engine == nullptr) {
            return;
        }
        engine->setTrancePower(power);
    }

    void applyTranceChance(double chance) {
        tranceChance = chance;
        if (engine == nullptr) {
            return;
        }
        engine->setTranceChance(chance);
    }

    void applyOutput(double volume, double pan) {
        outputVolume = volume;
        outputPan = pan;
        if (engine == nullptr) {
            return;
        }
        engine->setOutput(volume, pan);
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
        case CommandQueue::Slot::Kind::Loop:
            applyLoop(slot.number);
            break;
        case CommandQueue::Slot::Kind::Slice:
            applySlice(slot.number);
            break;
        case CommandQueue::Slot::Kind::Attack:
            applyAttack(slot.number);
            break;
        case CommandQueue::Slot::Kind::GlobalPower:
            applyGlobalPower(slot.first);
            break;
        case CommandQueue::Slot::Kind::GlobalBeat:
            applyGlobalBeat(slot.number);
            break;
        case CommandQueue::Slot::Kind::GlobalChance:
            applyGlobalChance(slot.first);
            break;
        case CommandQueue::Slot::Kind::ReverbPower:
            applyReverbPower(slot.first);
            break;
        case CommandQueue::Slot::Kind::ReverbChance:
            applyReverbChance(slot.first);
            break;
        case CommandQueue::Slot::Kind::DelayPower:
            applyDelayPower(slot.first);
            break;
        case CommandQueue::Slot::Kind::DelayChance:
            applyDelayChance(slot.first);
            break;
        case CommandQueue::Slot::Kind::ReversePower:
            applyReversePower(slot.first);
            break;
        case CommandQueue::Slot::Kind::ReverseChance:
            applyReverseChance(slot.first);
            break;
        case CommandQueue::Slot::Kind::FilterPower:
            applyFilterPower(slot.first);
            break;
        case CommandQueue::Slot::Kind::FilterChance:
            applyFilterChance(slot.first);
            break;
        case CommandQueue::Slot::Kind::FlangerPower:
            applyFlangerPower(slot.first);
            break;
        case CommandQueue::Slot::Kind::FlangerChance:
            applyFlangerChance(slot.first);
            break;
        case CommandQueue::Slot::Kind::TrancePower:
            applyTrancePower(slot.first);
            break;
        case CommandQueue::Slot::Kind::TranceChance:
            applyTranceChance(slot.first);
            break;
        case CommandQueue::Slot::Kind::Track:
            applyTrack(slot.index, slot.first, slot.second, slot.flag, slot.third, slot.fourth);
            break;
        case CommandQueue::Slot::Kind::Output:
            applyOutput(slot.first, slot.second);
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
        bpm = pack->bpm;
        loopBeats = pack->loop;
        sliceExp = pack->slices;
        attackMs = pack->attack;
        outputVolume = pack->volume;
        outputPan = pack->pan;
        if (engine != nullptr) {
            engine->setBpm(bpm);
            engine->setLoop(loopBeats);
            engine->setSlice(sliceExp);
            engine->setAttack(attackMs);
            engine->setOutput(outputVolume, outputPan);
        }
        int index = 0;
        for (PackTrackPayload& track : pack->tracks) {
            SourceTrack source;
            source.start = track.start;
            source.length = track.length;
            source.loop = track.loop;
            source.volume = track.volume;
            source.pan = track.pan;
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
                    engine->setIndexedTrack(index, source.start, source.length, source.loop, source.volume, source.pan);
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
                engine->setIndexedTrack(index, source.start, source.length, source.loop, source.volume, source.pan);
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
                engine->setIndexedTrack(index, source.start, source.length, source.loop, source.volume, source.pan);
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
            engine->setIndexedTrack(index, source.start, source.length, source.loop, source.volume, source.pan);
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
    double bpm = 120;
    int loopBeats = 8;
    int sliceExp = 0;
    int attackMs = bt::SliceEngine::kAttackMinMs;
    double globalPower = 1;
    int globalBeatExp = 0;
    double globalChance = 0;
    double reverbPower = 1;
    double reverbChance = 0;
    double delayPower = 1;
    double delayChance = 0;
    double reversePower = 1;
    double reverseChance = 0;
    double filterPower = 1;
    double filterChance = 0;
    double flangerPower = 1;
    double flangerChance = 0;
    double trancePower = 1;
    double tranceChance = 0;
    double outputVolume = 1;
    double outputPan = 0;
};

Processor::Processor()
    : juce::AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      impl(std::make_unique<Impl>(view, slot, head)) {}

Processor::~Processor() {
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
    for (const auto& file : files) {
        if (!canAppend()) {
            break;
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
        CommandQueue::Slot slot;
        slot.kind = CommandQueue::Slot::Kind::Append;
        slot.append = payload;
        if (!impl->queue.push(slot)) {
            freePayload(payload);
            break;
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

void Processor::setLoop(int beats) {
    if (beats < bt::SliceGrid::kMinLoop || beats > bt::SliceGrid::kMaxLoop) {
        return;
    }
    savedLoop = beats;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Loop;
    slot.number = beats;
    impl->queue.push(slot);
}

void Processor::setSlice(int exponent) {
    if (exponent < bt::SliceGrid::kExpMin || exponent > bt::SliceGrid::kExpMax) {
        return;
    }
    savedSlice = exponent;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Slice;
    slot.number = exponent;
    impl->queue.push(slot);
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

void Processor::setGlobalPower(double power) {
    if (!std::isfinite(power) || power < bt::SliceEngine::kGlobalPowerMin || power > bt::SliceEngine::kGlobalPowerMax) {
        return;
    }
    savedGlobalPower = power;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::GlobalPower;
    slot.first = power;
    impl->queue.push(slot);
}

void Processor::setGlobalBeat(int exponent) {
    if (exponent < bt::SliceEngine::kGlobalBeatExpMin || exponent > bt::SliceEngine::kGlobalBeatExpMax) {
        return;
    }
    savedGlobalBeat = exponent;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::GlobalBeat;
    slot.number = exponent;
    impl->queue.push(slot);
}

void Processor::setGlobalChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::SliceEngine::kGlobalChanceMin || chance > bt::SliceEngine::kGlobalChanceMax) {
        return;
    }
    savedGlobalChance = chance;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::GlobalChance;
    slot.first = chance;
    impl->queue.push(slot);
}

void Processor::setReverbPower(double power) {
    if (!std::isfinite(power) || power < bt::SliceEngine::kReverbPowerMin || power > bt::SliceEngine::kReverbPowerMax) {
        return;
    }
    savedReverbPower = power;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::ReverbPower;
    slot.first = power;
    impl->queue.push(slot);
}

void Processor::setReverbChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::SliceEngine::kReverbChanceMin || chance > bt::SliceEngine::kReverbChanceMax) {
        return;
    }
    savedReverbChance = chance;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::ReverbChance;
    slot.first = chance;
    impl->queue.push(slot);
}

void Processor::setDelayPower(double power) {
    if (!std::isfinite(power) || power < bt::SliceEngine::kDelayPowerMin || power > bt::SliceEngine::kDelayPowerMax) {
        return;
    }
    savedDelayPower = power;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::DelayPower;
    slot.first = power;
    impl->queue.push(slot);
}

void Processor::setDelayChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::SliceEngine::kDelayChanceMin || chance > bt::SliceEngine::kDelayChanceMax) {
        return;
    }
    savedDelayChance = chance;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::DelayChance;
    slot.first = chance;
    impl->queue.push(slot);
}

void Processor::setReversePower(double power) {
    if (!std::isfinite(power) || power < bt::SliceEngine::kReversePowerMin || power > bt::SliceEngine::kReversePowerMax) {
        return;
    }
    savedReversePower = power;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::ReversePower;
    slot.first = power;
    impl->queue.push(slot);
}

void Processor::setReverseChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::SliceEngine::kReverseChanceMin || chance > bt::SliceEngine::kReverseChanceMax) {
        return;
    }
    savedReverseChance = chance;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::ReverseChance;
    slot.first = chance;
    impl->queue.push(slot);
}

void Processor::setFilterPower(double power) {
    if (!std::isfinite(power) || power < bt::SliceEngine::kFilterPowerMin || power > bt::SliceEngine::kFilterPowerMax) {
        return;
    }
    savedFilterPower = power;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::FilterPower;
    slot.first = power;
    impl->queue.push(slot);
}

void Processor::setFilterChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::SliceEngine::kFilterChanceMin || chance > bt::SliceEngine::kFilterChanceMax) {
        return;
    }
    savedFilterChance = chance;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::FilterChance;
    slot.first = chance;
    impl->queue.push(slot);
}

void Processor::setFlangerPower(double power) {
    if (!std::isfinite(power) || power < bt::SliceEngine::kFlangerPowerMin || power > bt::SliceEngine::kFlangerPowerMax) {
        return;
    }
    savedFlangerPower = power;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::FlangerPower;
    slot.first = power;
    impl->queue.push(slot);
}

void Processor::setFlangerChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::SliceEngine::kFlangerChanceMin || chance > bt::SliceEngine::kFlangerChanceMax) {
        return;
    }
    savedFlangerChance = chance;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::FlangerChance;
    slot.first = chance;
    impl->queue.push(slot);
}

void Processor::setTrancePower(double power) {
    if (!std::isfinite(power) || power < bt::SliceEngine::kTrancePowerMin || power > bt::SliceEngine::kTrancePowerMax) {
        return;
    }
    savedTrancePower = power;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::TrancePower;
    slot.first = power;
    impl->queue.push(slot);
}

void Processor::setTranceChance(double chance) {
    if (!std::isfinite(chance) || chance < bt::SliceEngine::kTranceChanceMin || chance > bt::SliceEngine::kTranceChanceMax) {
        return;
    }
    savedTranceChance = chance;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::TranceChance;
    slot.first = chance;
    impl->queue.push(slot);
}

void Processor::setOutput(double volume, double pan) {
    if (!std::isfinite(volume) || !std::isfinite(pan)) {
        return;
    }
    savedVolume = volume;
    savedPan = pan;
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Output;
    slot.first = volume;
    slot.second = pan;
    impl->queue.push(slot);
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
    payload->pan = decoded->pan;
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

        TrackPicture picture;
        picture.internal = track.internal;
        picture.address = track.address;
        picture.start = track.start;
        picture.length = track.length;
        picture.loop = track.loop;
        picture.volume = track.volume;
        picture.pan = track.pan;
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
    savedLoop = decoded->loop;
    savedSlice = decoded->slices;
    savedAttack = decoded->attack;
    savedVolume = decoded->volume;
    savedPan = decoded->pan;
    impl->storeSequence(decoded->slots, decoded->savedCount);
    error.clear();
    return true;
}

juce::String Processor::packText() {
    PackDocument pack;
    pack.name = savedName;
    pack.bpm = savedBpm;
    pack.loop = savedLoop;
    pack.slices = savedSlice;
    pack.attack = savedAttack;
    pack.volume = savedVolume;
    pack.pan = savedPan;
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

bool Processor::trackMissing(int index) const {
    return index >= 0 && index < static_cast<int>(pictures.size()) && pictures[static_cast<std::size_t>(index)].missing;
}

juce::String Processor::errorText() const {
    return error;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new Processor();
}
