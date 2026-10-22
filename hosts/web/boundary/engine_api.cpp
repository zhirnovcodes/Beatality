// Functions the browser calls on the compiled core. Plain C ABI, no Emscripten JS glue.
// This is the web engine. The plugin keeps the 0.0.1 core.

#include "SliceEngine.h"

#include <cstdint>
#include <cstdlib>
#include <new>

namespace {

// Play, Stop, and Randomize. The same numbers are in hosts/web/messages.ts.
constexpr int kPlay = 0;
constexpr int kStop = 1;
constexpr int kRandomize = 2;

struct Instance {
    bt::SliceEngine engine;
    bt::SliceSnapshot snapshot;

    Instance(double sampleRate, std::uint64_t seed) : engine(sampleRate, seed) {}
};

} // namespace

#define BT_EXPORT extern "C" __attribute__((used, visibility("default")))

BT_EXPORT void* bt_alloc(int bytes) {
    return bytes > 0 ? std::malloc(static_cast<std::size_t>(bytes)) : nullptr;
}

BT_EXPORT void bt_free(void* ptr) {
    std::free(ptr);
}

BT_EXPORT Instance* bt_create(double sampleRate, std::uint32_t seed) {
    if (!(sampleRate > 0.0)) {
        return nullptr;
    }
    void* memory = std::malloc(sizeof(Instance));
    return memory != nullptr ? new (memory) Instance(sampleRate, seed) : nullptr;
}

BT_EXPORT void bt_destroy(Instance* instance) {
    if (instance != nullptr) {
        instance->~Instance();
        std::free(instance);
    }
}

// `planar` holds `frames` left samples followed by `frames` right samples.
// The memory must stay alive until `id` is reported released. Returns 1 on success.
BT_EXPORT int bt_append(Instance* instance, std::uint32_t id, const float* planar, int frames) {
    if (instance == nullptr || planar == nullptr || frames <= 0) {
        return 0;
    }
    if (instance->engine.count() >= bt::SliceEngine::kMaxTracks) {
        return 0;
    }
    const bt::SampleBuffer buffer{id, planar, planar + frames, frames};
    instance->engine.append(buffer);
    return 1;
}

// `type` is Play, Stop, or Randomize.
BT_EXPORT void bt_command(Instance* instance, int type) {
    if (instance == nullptr) {
        return;
    }
    if (type == kPlay) {
        instance->engine.play();
    } else if (type == kStop) {
        instance->engine.stop();
    } else if (type == kRandomize) {
        instance->engine.randomize();
    }
}

BT_EXPORT void bt_remove(Instance* instance, int index) {
    if (instance == nullptr || index < 0 || index >= instance->engine.count()) {
        return;
    }
    instance->engine.remove(index);
}

BT_EXPORT void bt_set_bpm(Instance* instance, double bpm) {
    if (instance == nullptr || !(bpm > 0.0)) {
        return;
    }
    instance->engine.setBpm(bpm);
}

BT_EXPORT void bt_set_loop(Instance* instance, int beats) {
    if (instance == nullptr || beats < bt::SliceGrid::kMinLoop || beats > bt::SliceGrid::kMaxLoop) {
        return;
    }
    instance->engine.setLoop(beats);
}

BT_EXPORT void bt_set_slice(Instance* instance, int exponent) {
    if (instance == nullptr || exponent < bt::SliceGrid::kExpMin || exponent > bt::SliceGrid::kExpMax) {
        return;
    }
    instance->engine.setSlice(exponent);
}

BT_EXPORT void bt_set_attack(Instance* instance, int ms) {
    if (instance == nullptr || ms < bt::SliceEngine::kAttackMinMs || ms > bt::SliceEngine::kAttackMaxMs) {
        return;
    }
    instance->engine.setAttack(ms);
}

// start and length are fractions of the file, 0..1. loop is 0 or 1.
BT_EXPORT void bt_set_track(Instance* instance, int index, double start, double length, int loop) {
    if (instance == nullptr) {
        return;
    }
    instance->engine.setTrack(index, start, length, loop != 0);
}

BT_EXPORT void bt_render(Instance* instance, float* left, float* right, int frames) {
    if (instance == nullptr || left == nullptr || right == nullptr || frames <= 0) {
        return;
    }
    instance->engine.render(left, right, frames);
}

// Takes a new snapshot; read it with the getters below.
BT_EXPORT void bt_snapshot(Instance* instance) {
    if (instance != nullptr) {
        instance->engine.fillSnapshot(instance->snapshot);
    }
}

BT_EXPORT int bt_snapshot_count(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.count : 0;
}

BT_EXPORT int bt_snapshot_playing(const Instance* instance) {
    return instance != nullptr && instance->snapshot.playing ? 1 : 0;
}

BT_EXPORT int bt_snapshot_slice_exp(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.sliceExp : 0;
}

BT_EXPORT int bt_snapshot_loop(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.loopBeats : 8;
}

BT_EXPORT double bt_snapshot_bpm(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.bpm : 120.0;
}

BT_EXPORT int bt_snapshot_play_slot(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.playSlot : -1;
}

BT_EXPORT int bt_snapshot_play_track(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.playTrack : -1;
}

BT_EXPORT int bt_snapshot_released_count(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.releasedCount : 0;
}

BT_EXPORT std::uint32_t bt_snapshot_released_id(const Instance* instance, int i) {
    if (instance == nullptr || i < 0 || i >= instance->snapshot.releasedCount) {
        return 0;
    }
    return instance->snapshot.released[i];
}
