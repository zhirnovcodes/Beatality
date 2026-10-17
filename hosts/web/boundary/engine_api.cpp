// Functions the browser calls on the compiled core. Plain C ABI, no Emscripten JS glue.

#include "Command.h"
#include "Engine.h"
#include "Snapshot.h"

#include <cstdint>
#include <cstdlib>
#include <new>

namespace {

struct Instance {
    bt::Engine engine;
    bt::Snapshot snapshot;

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
    bt::Command command;
    command.type = bt::Command::Type::Append;
    command.buffer = {id, planar, planar + frames, frames};
    return instance->engine.apply(command) ? 1 : 0;
}

// `type` is a bt::Command::Type value other than Append.
BT_EXPORT void bt_command(Instance* instance, int type) {
    if (instance == nullptr || type < 0 || type > static_cast<int>(bt::Command::Type::RemoveFirst)) {
        return;
    }
    bt::Command command;
    command.type = static_cast<bt::Command::Type>(type);
    instance->engine.apply(command);
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

BT_EXPORT int bt_snapshot_index(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.index : -1;
}

BT_EXPORT int bt_snapshot_playing(const Instance* instance) {
    return instance != nullptr && instance->snapshot.playing ? 1 : 0;
}

BT_EXPORT double bt_snapshot_position(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.position : 0.0;
}

BT_EXPORT double bt_snapshot_duration(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.duration : 0.0;
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
