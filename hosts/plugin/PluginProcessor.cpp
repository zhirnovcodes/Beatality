#include "PluginProcessor.h"

#include "PluginEditor.h"

#include "Engine.h"

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

class CommandQueue {
public:
    struct Slot {
        enum class Kind { Play, Stop, Randomize, RemoveFirst, Append };
        Kind kind = Kind::Play;
        AppendPayload* append = nullptr;
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
        engine = std::make_unique<bt::Engine>(rate, seed);
        trackCount = 0;
        chosen = -1;
        playing = false;
    }

    void publish() {
        view.store(packView(trackCount, chosen, playing), std::memory_order_release);
    }

    void remember() {
        if (engine == nullptr) {
            return;
        }
        bt::Snapshot snapshot;
        engine->fillSnapshot(snapshot);
        trackCount = snapshot.count;
        chosen = snapshot.index;
        playing = snapshot.playing;
        for (int i = 0; i < snapshot.releasedCount; ++i) {
            const std::uint32_t id = snapshot.released[i];
            std::erase_if(devices, [id](const DeviceAudio& device) { return device.id == id; });
        }
        publish();
    }

    void apply(bt::Command::Type type) {
        if (engine == nullptr) {
            return;
        }
        bt::Command command;
        command.type = type;
        engine->apply(command);
        remember();
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

        if (engine == nullptr || sources.size() >= static_cast<std::size_t>(bt::Session::kMaxTracks) ||
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

        bt::Command command;
        command.type = bt::Command::Type::Append;
        command.buffer.id = device.id;
        command.buffer.left = device.left.get();
        command.buffer.right = device.right.get();
        command.buffer.frames = device.frames;
        if (!engine->apply(command)) {
            return;
        }
        sources.push_back(std::move(source));
        devices.push_back(std::move(device));
        remember();
    }

    void applyRemove() {
        if (sources.empty()) {
            return;
        }
        sources.erase(sources.begin());
        apply(bt::Command::Type::RemoveFirst);
    }

    void applySlot(CommandQueue::Slot slot) {
        switch (slot.kind) {
        case CommandQueue::Slot::Kind::Play:
            apply(bt::Command::Type::Play);
            break;
        case CommandQueue::Slot::Kind::Stop:
            apply(bt::Command::Type::Stop);
            break;
        case CommandQueue::Slot::Kind::Randomize:
            if (captureRandomize) {
                randomizeRequested = true;
            }
            apply(bt::Command::Type::Randomize);
            break;
        case CommandQueue::Slot::Kind::RemoveFirst:
            applyRemove();
            break;
        case CommandQueue::Slot::Kind::Append:
            applyAppend(slot.append);
            break;
        }
    }

    void drain() {
        queue.drain([this](CommandQueue::Slot slot) { applySlot(slot); });
    }

    void playIfGateHeld() {
        if (gateOpen && !playing && chosen >= 0 && trackCount > 0) {
            apply(bt::Command::Type::Play);
        }
    }

    void openGate() {
        gateOpen = true;
        if (trackCount <= 0) {
            return;
        }
        if (chosen < 0) {
            apply(bt::Command::Type::Randomize);
        }
        apply(bt::Command::Type::Play);
    }

    void closeGate() {
        gateOpen = false;
        apply(bt::Command::Type::Stop);
    }

    void handleMidi(const juce::MidiMessage& message) {
        if (message.isAllNotesOff() || message.isAllSoundOff()) {
            heldNotes = 0;
            if (gateOpen) {
                closeGate();
            }
            return;
        }
        if (message.isNoteOn()) {
            if (heldNotes == 0) {
                openGate();
            }
            ++heldNotes;
            return;
        }
        if (message.isNoteOff() && heldNotes > 0) {
            --heldNotes;
            if (heldNotes == 0) {
                closeGate();
            }
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
            chosen = -1;
            playing = false;
            publish();
            return;
        }
        createEngine();
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
            bt::Command command;
            command.type = bt::Command::Type::Append;
            command.buffer.id = device.id;
            command.buffer.left = device.left.get();
            command.buffer.right = device.right.get();
            command.buffer.frames = device.frames;
            if (!engine->apply(command)) {
                continue;
            }
            devices.push_back(std::move(device));
        }
        remember();
        // A new engine has no chosen sample. A held note, or a randomize that
        // arrived with this rebuild, picks one and a held note starts it.
        if (trackCount > 0 && (pick || (gateOpen && chosen < 0))) {
            apply(bt::Command::Type::Randomize);
        }
        playIfGateHeld();
    }

    std::atomic<std::uint32_t>& view;
    juce::AudioFormatManager formats;
    CommandQueue queue;
    std::vector<SourceTrack> sources;
    std::vector<DeviceAudio> devices;
    std::unique_ptr<bt::Engine> engine;
    double rate = 0;
    std::atomic<double> publishedRate{0.0};
    std::atomic<std::uint32_t> nextId{1};
    std::uint64_t seed = static_cast<std::uint64_t>(juce::Random::getSystemRandom().nextInt64());
    int trackCount = 0;
    int chosen = -1;
    bool playing = false;
    bool gateOpen = false;
    int heldNotes = 0;
    bool captureRandomize = false;
    bool randomizeRequested = false;
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
    impl->playIfGateHeld();

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
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->lengthInSamples > 0x7fffffff) {
            skipped = true;
            continue;
        }
        const int frames = static_cast<int>(reader->lengthInSamples);
        juce::AudioBuffer<float> decoded(std::max(1, static_cast<int>(reader->numChannels)), frames);
        if (!reader->read(&decoded, 0, frames, 0, true, true)) {
            skipped = true;
            continue;
        }
        const float* left = decoded.getReadPointer(0);
        const float* right = reader->numChannels > 1 ? decoded.getReadPointer(1) : left;
        auto* payload = new AppendPayload;
        payload->id = impl->nextId.fetch_add(1, std::memory_order_relaxed);
        payload->sourceRate = reader->sampleRate;
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
        CommandQueue::Slot randomize;
        randomize.kind = CommandQueue::Slot::Kind::Randomize;
        if (!impl->queue.push(randomize)) {
            error = "Could not randomize after adding.";
            return;
        }
        error.clear();
    } else if (skipped) {
        error = "Could not read those files.";
    }
}

void Processor::removeFirstTrack() {
    if (names.isEmpty()) {
        return;
    }
    CommandQueue::Slot remove;
    remove.kind = CommandQueue::Slot::Kind::RemoveFirst;
    if (!impl->queue.push(remove)) {
        return;
    }
    names.remove(0);
    error.clear();
    if (!names.isEmpty()) {
        CommandQueue::Slot randomize;
        randomize.kind = CommandQueue::Slot::Kind::Randomize;
        if (!impl->queue.push(randomize)) {
            error = "Could not randomize after removing.";
        }
    }
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
    return names.size() < bt::Session::kMaxTracks;
}

juce::String Processor::trackName(int index) const {
    if (index < 0 || index >= names.size()) {
        return {};
    }
    return names[index];
}

int Processor::chosenIndex() const {
    return unpackIndex(view.load(std::memory_order_acquire));
}

juce::String Processor::errorText() const {
    return error;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new Processor();
}
