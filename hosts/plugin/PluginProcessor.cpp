#include "PluginProcessor.h"

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
        enum class Kind { Randomize, Remove, Append, Clear, Bpm, Loop, Slice, Attack, Track };
        Kind kind = Kind::Randomize;
        AppendPayload* append = nullptr;
        int index = 0;
        int number = 0;
        double first = 0;
        double second = 0;
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
        drain([](Slot slot) { freePayload(slot.append); });
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
};

struct DeviceAudio {
    std::uint32_t id = 0;
    int frames = 0;
    std::unique_ptr<float[]> left;
    std::unique_ptr<float[]> right;
};

} // namespace

struct Processor::Impl {
    explicit Impl(std::atomic<std::uint32_t>& viewIn) : view(viewIn) {
        formats.registerBasicFormats();
    }

    void createEngine() {
        engine = std::make_unique<bt::SliceEngine>(rate, seed);
        trackCount = 0;
        playTrack = -1;
        playing = false;
    }

    void publish() {
        view.store(packView(trackCount, playTrack, playing), std::memory_order_release);
    }

    void remember() {
        if (engine == nullptr) {
            return;
        }
        bt::SliceSnapshot snapshot;
        engine->fillSnapshot(snapshot);
        trackCount = snapshot.count;
        playTrack = snapshot.playTrack;
        playing = snapshot.playing;
        bpm = snapshot.bpm;
        loopBeats = snapshot.loopBeats;
        sliceExp = snapshot.sliceExp;
        for (int i = 0; i < snapshot.releasedCount; ++i) {
            const std::uint32_t id = snapshot.released[i];
            std::erase_if(devices, [id](const DeviceAudio& device) { return device.id == id; });
        }
        publish();
    }

    void restoreGrid() {
        engine->setBpm(bpm);
        engine->setLoop(loopBeats);
        engine->setSlice(sliceExp);
        engine->setAttack(attackMs);
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

    void applyTrack(int index, double start, double length, bool loop) {
        if (index >= 0 && index < static_cast<int>(sources.size())) {
            sources[static_cast<std::size_t>(index)].start = start;
            sources[static_cast<std::size_t>(index)].length = length;
            sources[static_cast<std::size_t>(index)].loop = loop;
        }
        if (engine == nullptr) {
            return;
        }
        engine->setTrack(index, start, length, loop);
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
        case CommandQueue::Slot::Kind::Track:
            applyTrack(slot.index, slot.first, slot.second, slot.flag);
            break;
        }
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

        engine.reset();
        devices.clear();
        if (!(rate > 0.0)) {
            trackCount = 0;
            playTrack = -1;
            playing = false;
            publish();
            return;
        }
        createEngine();
        restoreGrid();
        int index = 0;
        for (const SourceTrack& source : sources) {
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
            engine->setTrack(index, source.start, source.length, source.loop);
            devices.push_back(std::move(device));
            ++index;
        }
        remember();
        // The new engine has an empty sequence. A randomize that arrived with
        // this rebuild builds one. A note that is still held starts the playhead.
        if (pick && trackCount > 0) {
            engine->randomize();
        }
        if (gate.held() > 0 && trackCount > 0) {
            engine->play();
        }
        remember();
    }

    std::atomic<std::uint32_t>& view;
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
    bool playing = false;
    bt::NoteGate gate;
    bool captureRandomize = false;
    bool randomizeRequested = false;
    double bpm = 120;
    int loopBeats = 8;
    int sliceExp = 0;
    int attackMs = bt::SliceEngine::kAttackMinMs;
};

Processor::Processor()
    : juce::AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      impl(std::make_unique<Impl>(view)) {}

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
        CommandQueue::Slot slot;
        slot.kind = CommandQueue::Slot::Kind::Append;
        slot.append = payload;
        if (!impl->queue.push(slot)) {
            freePayload(payload);
            break;
        }
        names.add(file.getFileName());
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

void Processor::setBpm(double bpm) {
    if (!(bpm > 0.0) || !std::isfinite(bpm)) {
        return;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Bpm;
    slot.first = bpm;
    impl->queue.push(slot);
}

void Processor::setLoop(int beats) {
    if (beats < bt::SliceGrid::kMinLoop || beats > bt::SliceGrid::kMaxLoop) {
        return;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Loop;
    slot.number = beats;
    impl->queue.push(slot);
}

void Processor::setSlice(int exponent) {
    if (exponent < bt::SliceGrid::kExpMin || exponent > bt::SliceGrid::kExpMax) {
        return;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Slice;
    slot.number = exponent;
    impl->queue.push(slot);
}

void Processor::setAttack(int ms) {
    if (ms < bt::SliceEngine::kAttackMinMs || ms > bt::SliceEngine::kAttackMaxMs) {
        return;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Attack;
    slot.number = ms;
    impl->queue.push(slot);
}

void Processor::setTrack(int index, double start, double length, bool loop) {
    if (index < 0 || index >= names.size() || !std::isfinite(start) || !std::isfinite(length)) {
        return;
    }
    CommandQueue::Slot slot;
    slot.kind = CommandQueue::Slot::Kind::Track;
    slot.index = index;
    slot.first = start;
    slot.second = length;
    slot.flag = loop;
    impl->queue.push(slot);
}

bool Processor::loadBank() {
    const double rate = impl->publishedRate.load(std::memory_order_relaxed);
    struct Item {
        AppendPayload* payload = nullptr;
        juce::String name;
    };
    std::vector<Item> items;
    for (int i = 0; i < BinaryData::namedResourceListSize && static_cast<int>(items.size()) < bt::SliceEngine::kMaxTracks; ++i) {
        int bytes = 0;
        const char* data = BinaryData::getNamedResource(BinaryData::namedResourceList[i], bytes);
        const char* filename = BinaryData::originalFilenames[i];
        if (data == nullptr || bytes <= 0 || filename == nullptr) {
            continue;
        }
        auto stream = std::make_unique<juce::MemoryInputStream>(data, static_cast<std::size_t>(bytes), false);
        std::unique_ptr<juce::AudioFormatReader> reader(impl->formats.createReaderFor(std::move(stream)));
        if (reader == nullptr) {
            continue;
        }
        auto* payload = payloadFromReader(*reader, rate, impl->nextId.fetch_add(1, std::memory_order_relaxed));
        if (payload == nullptr) {
            continue;
        }
        items.push_back(Item{payload, filename});
    }
    if (items.empty()) {
        error = "Could not read the Demo bank.";
        return false;
    }

    CommandQueue::Slot clear;
    clear.kind = CommandQueue::Slot::Kind::Clear;
    if (!impl->queue.push(clear)) {
        for (const Item& item : items) {
            freePayload(item.payload);
        }
        error = "Could not load the Demo bank.";
        return false;
    }

    juce::StringArray loaded;
    for (const Item& item : items) {
        CommandQueue::Slot slot;
        slot.kind = CommandQueue::Slot::Kind::Append;
        slot.append = item.payload;
        if (!impl->queue.push(slot)) {
            freePayload(item.payload);
            continue;
        }
        loaded.add(item.name);
    }
    names = loaded;
    if (names.isEmpty()) {
        error = "Could not load the Demo bank.";
        return false;
    }
    error.clear();
    return true;
}

juce::String Processor::errorText() const {
    return error;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new Processor();
}
