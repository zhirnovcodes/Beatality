// Functions the browser calls on the compiled core. Plain C ABI, no Emscripten JS glue.
// This is the web engine. The plugin calls the same slice engine directly.

#include "NoteGate.h"
#include "SliceEngine.h"

#include <cstdint>
#include <cstdlib>
#include <new>

namespace {

// Note-off, note-on, and all-notes-off. The same numbers are in hosts/web/messages.ts.
constexpr int kNoteOff = 0;
constexpr int kNoteOn = 1;
constexpr int kAllOff = 2;

struct Instance {
    bt::SliceEngine engine;
    bt::SliceSnapshot snapshot;
    bt::NoteGate gate;
    float velocity = 1.0f;
    // The engine changed its own knobs (a chaos roll) since bt_controls_changed last answered.
    bool controlsChanged = false;

    Instance(double sampleRate, std::uint64_t seed) : engine(sampleRate, seed) {}
};

void applyGate(Instance& instance, bt::Gate signal) {
    if (signal == bt::Gate::Start) {
        if (instance.engine.count() > 0) {
            instance.engine.play();
        }
        return;
    }
    if (signal == bt::Gate::Stop) {
        instance.engine.stop();
    }
}

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

// A slot with no audio. The sequence index still points here. Playback is silent.
BT_EXPORT int bt_append_empty(Instance* instance, std::uint32_t id) {
    if (instance == nullptr || instance->engine.count() >= bt::SliceEngine::kMaxTracks) {
        return 0;
    }
    const bt::SampleBuffer buffer{id, nullptr, nullptr, 0};
    instance->engine.append(buffer);
    return 1;
}

// Replaces the sequence after bpm, loop, and slice have been set.
BT_EXPORT void bt_install_sequence(Instance* instance, const std::uint16_t* slots, int size, int savedCount) {
    if (instance == nullptr || size < 0 || size > bt::Sequence::kMaxSlots || (size > 0 && slots == nullptr)) {
        return;
    }
    instance->engine.installSequence(slots, size, savedCount);
}

// status is note-off, note-on, or all-off. Note is unused.
// Velocity is 0..1. It scales the mix after output volume.
BT_EXPORT void bt_midi(Instance* instance, int status, int, double velocity) {
    if (instance == nullptr) {
        return;
    }
    if (status == kNoteOn) {
        if (velocity < 0.0) {
            velocity = 0.0;
        } else if (velocity > 1.0) {
            velocity = 1.0;
        }
        instance->velocity = static_cast<float>(velocity);
        applyGate(*instance, instance->gate.noteOn());
        const bt::Controls before = instance->engine.controls();
        instance->engine.noteOn();
        instance->controlsChanged = instance->controlsChanged || instance->engine.controls() != before;
    } else if (status == kNoteOff) {
        applyGate(*instance, instance->gate.noteOff());
    } else if (status == kAllOff) {
        applyGate(*instance, instance->gate.allOff());
    }
}

// Every chaos mode also rolls on Randomize.
BT_EXPORT void bt_randomize(Instance* instance) {
    if (instance == nullptr) {
        return;
    }
    const bt::Controls before = instance->engine.controls();
    if (instance->engine.count() > 0) {
        instance->engine.randomize();
    }
    instance->engine.triggerChaos();
    instance->controlsChanged = instance->controlsChanged || instance->engine.controls() != before;
}

// trigger is a bt::ChaosTrigger, 0..4. value is 0..1. beatSize is -2..1, loopSize 1..8, sliceSize -1..2.
// groups is a bit mask in bt::ChaosGroup order: bit 0 is Pan.
BT_EXPORT void bt_set_chaos(Instance* instance, int trigger, double value, int beatSize, int loopSize, int sliceSize, int groups) {
    if (instance == nullptr || trigger < 0 || trigger > static_cast<int>(bt::ChaosTrigger::Beats)) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    bt::ChaosSettings& chaos = controls.chaos;
    chaos.trigger = static_cast<bt::ChaosTrigger>(trigger);
    chaos.value = value;
    chaos.beatSize = beatSize;
    chaos.loopSize = loopSize;
    chaos.sliceSize = sliceSize;
    for (int group = 0; group < bt::ChaosSettings::kGroups; ++group) {
        chaos.groups[group] = (groups & (1 << group)) != 0;
    }
    instance->engine.apply(controls);
}

// 1 once after the engine changed its own knobs, then 0 until the next change.
BT_EXPORT int bt_controls_changed(Instance* instance) {
    if (instance == nullptr || !instance->controlsChanged) {
        return 0;
    }
    instance->controlsChanged = false;
    return 1;
}

// The knobs chaos can change, as doubles, in this order. The processor reads them in the same order.
//  0 panMin, 1 panMax, 2 sliceExp, 3 attackMs,
//  4 effects on, 5 global power, 6 global chance, 7 time min, 8 time max,
//  9..22 power and chance for delay, reverb, reverse, filter, flanger, trance, shift,
// 23 repeat on, 24 size min, 25 size max, 26 length, 27 chance, 28 mix, 29..36 loop parts,
// 37 chaos value, 38 beat size, 39 loop size, 40 slice size.
constexpr int kControlsCount = 41;

BT_EXPORT int bt_controls_write(const Instance* instance, double* out) {
    if (instance == nullptr || out == nullptr) {
        return 0;
    }
    const bt::Controls& c = instance->engine.controls();
    const bt::Effects& fx = c.effects;
    const double values[] = {
        c.play.panMin, c.play.panMax, static_cast<double>(c.play.sliceExp), static_cast<double>(c.play.attackMs),
        fx.enabled ? 1.0 : 0.0, fx.globalPower, fx.globalChance, static_cast<double>(fx.beatMin), static_cast<double>(fx.beatMax),
        fx.delayPower, fx.delayChance, fx.reverbPower, fx.reverbChance, fx.reversePower, fx.reverseChance,
        fx.filterPower, fx.filterChance, fx.flangerPower, fx.flangerChance, fx.trancePower, fx.tranceChance,
        fx.shiftPower, fx.shiftChance,
        c.repeat.enabled ? 1.0 : 0.0, static_cast<double>(c.repeat.sizeMin), static_cast<double>(c.repeat.sizeMax),
        static_cast<double>(c.repeat.length), c.repeat.chance, c.repeat.mix,
        c.repeat.positions[0] ? 1.0 : 0.0, c.repeat.positions[1] ? 1.0 : 0.0, c.repeat.positions[2] ? 1.0 : 0.0,
        c.repeat.positions[3] ? 1.0 : 0.0, c.repeat.positions[4] ? 1.0 : 0.0, c.repeat.positions[5] ? 1.0 : 0.0,
        c.repeat.positions[6] ? 1.0 : 0.0, c.repeat.positions[7] ? 1.0 : 0.0,
        c.chaos.value, static_cast<double>(c.chaos.beatSize), static_cast<double>(c.chaos.loopSize),
        static_cast<double>(c.chaos.sliceSize),
    };
    static_assert(sizeof(values) / sizeof(values[0]) == kControlsCount);
    for (int i = 0; i < kControlsCount; ++i) {
        out[i] = values[i];
    }
    return kControlsCount;
}

BT_EXPORT void bt_remove(Instance* instance, int index) {
    if (instance == nullptr || index < 0 || index >= instance->engine.count()) {
        return;
    }
    instance->engine.remove(index);
}

BT_EXPORT void bt_clear(Instance* instance) {
    if (instance == nullptr) {
        return;
    }
    instance->engine.clear();
}

BT_EXPORT void bt_set_bpm(Instance* instance, double bpm) {
    if (instance == nullptr || !(bpm > 0.0)) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.play.bpm = bpm;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_loop(Instance* instance, int beats) {
    if (instance == nullptr || beats < bt::SliceGrid::kMinLoop || beats > bt::SliceGrid::kMaxLoop) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.play.loop = beats;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_slice(Instance* instance, int exponent) {
    if (instance == nullptr || exponent < bt::SliceGrid::kExpMin || exponent > bt::SliceGrid::kExpMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.play.sliceExp = exponent;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_attack(Instance* instance, int ms) {
    if (instance == nullptr || ms < bt::SliceEngine::kAttackMinMs || ms > bt::SliceEngine::kAttackMaxMs) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.play.attackMs = ms;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_global_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.globalPower = power;
    instance->engine.apply(controls);
}

// on is 0 or 1.
BT_EXPORT void bt_set_effects_enabled(Instance* instance, int on) {
    if (instance == nullptr) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.enabled = on != 0;
    instance->engine.apply(controls);
}

// 2^exponent beats, -4..1. min is not above max.
BT_EXPORT void bt_set_global_beat_range(Instance* instance, int min, int max) {
    if (instance == nullptr || min < bt::Effects::kBeatMin || max > bt::Effects::kBeatMax || min > max) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.beatMin = min;
    controls.effects.beatMax = max;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_global_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.globalChance = chance;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_reverb_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.reverbPower = power;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_reverb_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.reverbChance = chance;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_delay_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.delayPower = power;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_delay_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.delayChance = chance;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_reverse_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.reversePower = power;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_reverse_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.reverseChance = chance;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_filter_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.filterPower = power;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_filter_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.filterChance = chance;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_flanger_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.flangerPower = power;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_flanger_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.flangerChance = chance;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_trance_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.trancePower = power;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_trance_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.tranceChance = chance;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_shift_power(Instance* instance, double power) {
    if (instance == nullptr || !(power >= bt::Effects::kPowerMin) || power > bt::Effects::kPowerMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.shiftPower = power;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_shift_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::Effects::kChanceMin) || chance > bt::Effects::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.effects.shiftChance = chance;
    instance->engine.apply(controls);
}

// on is 0 or 1.
BT_EXPORT void bt_set_repeat_enabled(Instance* instance, int on) {
    if (instance == nullptr) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.repeat.enabled = on != 0;
    instance->engine.apply(controls);
}

// 2^exponent beats, -5..1. min is not above max.
BT_EXPORT void bt_set_repeat_size_range(Instance* instance, int min, int max) {
    if (instance == nullptr || min < bt::BeatRepeatSettings::kSizeMin || max > bt::BeatRepeatSettings::kSizeMax || min > max) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.repeat.sizeMin = min;
    controls.repeat.sizeMax = max;
    instance->engine.apply(controls);
}

// 2^exponent beats of tail, -4..1.
BT_EXPORT void bt_set_repeat_length(Instance* instance, int exponent) {
    if (instance == nullptr || exponent < bt::BeatRepeatSettings::kLengthMin || exponent > bt::BeatRepeatSettings::kLengthMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.repeat.length = exponent;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_repeat_chance(Instance* instance, double chance) {
    if (instance == nullptr || !(chance >= bt::BeatRepeatSettings::kChanceMin) || chance > bt::BeatRepeatSettings::kChanceMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.repeat.chance = chance;
    instance->engine.apply(controls);
}

// index is 0..7. on is 0 or 1.
BT_EXPORT void bt_set_repeat_position(Instance* instance, int index, int on) {
    if (instance == nullptr || index < 0 || index >= bt::RepeatSequence::kPositions) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.repeat.positions[index] = on != 0;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_set_repeat_mix(Instance* instance, double mix) {
    if (instance == nullptr || !(mix >= bt::BeatRepeatSettings::kMixMin) || mix > bt::BeatRepeatSettings::kMixMax) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.repeat.mix = mix;
    instance->engine.apply(controls);
}

// start is a fraction of the file, 0..1. length is 0..1. loop is 0 or 1.
// volume is 0..1.2. pan is -1..1.
// warp is 0 None, 1 Beat, 2 Pitch. Any other number is None.
// bpm is the sample's own tempo, 1..999.9. param is 0..1.
BT_EXPORT void bt_set_track(Instance* instance, int index, double start, double length, int loop, double volume, double pan, int warp,
                            double bpm, double param) {
    if (instance == nullptr) {
        return;
    }
    instance->engine.setIndexedTrack(index, start, length, loop != 0, volume, pan);
    const bt::WarpMode mode = warp >= 0 && warp <= 2 ? static_cast<bt::WarpMode>(warp) : bt::WarpMode::None;
    instance->engine.setWarp(index, bt::WarpSettings{.mode = mode, .bpm = bpm, .param = param});
}

// volume is 0..1.2 and multiplies note velocity. panMin and panMax are -1..1, panMin never above panMax.
BT_EXPORT void bt_set_output(Instance* instance, double volume, double panMin, double panMax) {
    if (instance == nullptr) {
        return;
    }
    bt::Controls controls = instance->engine.controls();
    controls.play.volume = volume;
    controls.play.panMin = panMin;
    controls.play.panMax = panMax;
    instance->engine.apply(controls);
}

BT_EXPORT void bt_render(Instance* instance, float* left, float* right, int frames) {
    if (instance == nullptr || left == nullptr || right == nullptr || frames <= 0) {
        return;
    }
    const bt::Controls before = instance->engine.controls();
    instance->engine.render(left, right, frames);
    instance->controlsChanged = instance->controlsChanged || instance->engine.controls() != before;
    const float velocity = instance->velocity;
    if (velocity == 1.0f) {
        return;
    }
    for (int i = 0; i < frames; ++i) {
        left[i] *= velocity;
        right[i] *= velocity;
    }
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

BT_EXPORT double bt_snapshot_playhead(const Instance* instance) {
    return instance != nullptr ? instance->snapshot.playhead : 0.0;
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
