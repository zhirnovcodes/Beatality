// Messages between the page and the AudioWorklet. The processor repeats the
// status numbers and the message shapes so that it can be served as one script.

// Note-off, note-on, and all-notes-off. The same numbers are in engine_api.cpp.
export const MidiStatus = {
    Off: 0,
    On: 1,
    AllOff: 2,
} as const

export interface InitMessage {
    type: 'init'
    wasm: ArrayBuffer
    seed: number
}

export interface AppendMessage {
    type: 'append'
    id: number
    frames: number
    planar: Float32Array
}

export interface RandomizeMessage {
    type: 'randomize'
}

// The plugin was closed. The processor stops, so the browser can let it go.
export interface DisposeMessage {
    type: 'dispose'
}

export interface MidiMessage {
    type: 'midi'
    frame: number
    status: number
    note: number
    velocity: number
}

export interface RemoveMessage {
    type: 'remove'
    index: number
}

export interface ClearMessage {
    type: 'clear'
}

export interface BpmMessage {
    type: 'bpm'
    bpm: number
}

export interface LoopMessage {
    type: 'loop'
    beats: number
}

export interface SliceMessage {
    type: 'slice'
    exponent: number
}

export interface AttackMessage {
    type: 'attack'
    ms: number
}

export interface GlobalPowerMessage {
    type: 'globalPower'
    power: number
}

export interface EffectsEnabledMessage {
    type: 'effectsEnabled'
    on: boolean
}

export interface GlobalBeatRangeMessage {
    type: 'globalBeatRange'
    min: number
    max: number
}

export interface GlobalChanceMessage {
    type: 'globalChance'
    chance: number
}

export interface ReverbPowerMessage {
    type: 'reverbPower'
    power: number
}

export interface ReverbChanceMessage {
    type: 'reverbChance'
    chance: number
}

export interface DelayPowerMessage {
    type: 'delayPower'
    power: number
}

export interface DelayChanceMessage {
    type: 'delayChance'
    chance: number
}

export interface ReversePowerMessage {
    type: 'reversePower'
    power: number
}

export interface ReverseChanceMessage {
    type: 'reverseChance'
    chance: number
}

export interface FilterPowerMessage {
    type: 'filterPower'
    power: number
}

export interface FilterChanceMessage {
    type: 'filterChance'
    chance: number
}

export interface FlangerPowerMessage {
    type: 'flangerPower'
    power: number
}

export interface FlangerChanceMessage {
    type: 'flangerChance'
    chance: number
}

export interface TrancePowerMessage {
    type: 'trancePower'
    power: number
}

export interface TranceChanceMessage {
    type: 'tranceChance'
    chance: number
}

export interface ShiftPowerMessage {
    type: 'shiftPower'
    power: number
}

export interface ShiftChanceMessage {
    type: 'shiftChance'
    chance: number
}

export interface RepeatEnabledMessage {
    type: 'repeatEnabled'
    on: boolean
}

export interface RepeatSizeRangeMessage {
    type: 'repeatSizeRange'
    min: number
    max: number
}

export interface RepeatLengthMessage {
    type: 'repeatLength'
    exponent: number
}

export interface RepeatChanceMessage {
    type: 'repeatChance'
    chance: number
}

export interface RepeatPositionMessage {
    type: 'repeatPosition'
    index: number
    on: boolean
}

export interface RepeatMixMessage {
    type: 'repeatMix'
    mix: number
}

// The chaos knobs. trigger is 0 Randomize button, 1 Note, 2 Loop, 3 Slices, 4 Beats.
// beatSize is 2^n beats, -2..1. loopSize is loops, 1..8. sliceSize is 2^n slices, -1..2.
// groups is 11 toggles in bt::ChaosGroup order: pan, slices, randomize, effects (global), effects on/off,
// effects (private), beat repeat on/off, beat repeat positions, beat repeat params, chaos value, chaos time.
export interface ChaosFields {
    trigger: number
    value: number
    beatSize: number
    loopSize: number
    sliceSize: number
    groups: boolean[]
}

export interface ChaosMessage extends ChaosFields {
    type: 'chaos'
}

export interface TrackMessage {
    type: 'track'
    index: number
    start: number
    length: number
    loop: boolean
    volume: number
    pan: number
    // The engine mode number: 0 none, 1 beat, 2 pitch.
    warp: number
    bpm: number
    warpParam: number
}

export interface OutputMessage {
    type: 'output'
    volume: number
    panMin: number
    panMax: number
}

export interface FreeMessage {
    type: 'free'
    id: number
}

export interface PackTrackMessage {
    id: number
    missing: boolean
    frames: number
    planar: Float32Array
    start: number
    length: number
    loop: boolean
    volume: number
    pan: number
    warp: number
    bpm: number
    warpParam: number
}

export interface PackMessage {
    type: 'pack'
    bpm: number
    loop: number
    slices: number
    attack: number
    volume: number
    panMin: number
    panMax: number
    savedCount: number
    slots: number[]
    tracks: PackTrackMessage[]
}

export type HostMessage =
    | InitMessage
    | AppendMessage
    | RandomizeMessage
    | MidiMessage
    | RemoveMessage
    | ClearMessage
    | BpmMessage
    | LoopMessage
    | SliceMessage
    | AttackMessage
    | GlobalPowerMessage
    | EffectsEnabledMessage
    | GlobalBeatRangeMessage
    | GlobalChanceMessage
    | ReverbPowerMessage
    | ReverbChanceMessage
    | DelayPowerMessage
    | DelayChanceMessage
    | ReversePowerMessage
    | ReverseChanceMessage
    | FilterPowerMessage
    | FilterChanceMessage
    | FlangerPowerMessage
    | FlangerChanceMessage
    | TrancePowerMessage
    | TranceChanceMessage
    | ShiftPowerMessage
    | ShiftChanceMessage
    | RepeatEnabledMessage
    | RepeatSizeRangeMessage
    | RepeatLengthMessage
    | RepeatChanceMessage
    | RepeatPositionMessage
    | RepeatMixMessage
    | ChaosMessage
    | TrackMessage
    | OutputMessage
    | FreeMessage
    | PackMessage
    | DisposeMessage

export interface ReadyMessage {
    type: 'ready'
}

export interface SnapshotMessage {
    type: 'snapshot'
    count: number
    playing: boolean
    sliceExp: number
    loopBeats: number
    bpm: number
    playSlot: number
    playTrack: number
    // 0 at the start of the loop, just under 1 at the end. 0 while stopped.
    playhead: number
    released: number[]
    peak: number
}

export interface ErrorMessage {
    type: 'error'
    message: string
}

// The knobs the engine plays, after it changed them itself with a chaos roll.
export interface EngineControls {
    panMin: number
    panMax: number
    sliceExp: number
    attackMs: number
    effectsEnabled: boolean
    globalPower: number
    globalChance: number
    beatMin: number
    beatMax: number
    delayPower: number
    delayChance: number
    reverbPower: number
    reverbChance: number
    reversePower: number
    reverseChance: number
    filterPower: number
    filterChance: number
    flangerPower: number
    flangerChance: number
    trancePower: number
    tranceChance: number
    shiftPower: number
    shiftChance: number
    repeatEnabled: boolean
    repeatSizeMin: number
    repeatSizeMax: number
    repeatLength: number
    repeatChance: number
    repeatMix: number
    repeatPositions: boolean[]
    chaosValue: number
    chaosBeatSize: number
    chaosLoopSize: number
    chaosSliceSize: number
}

export interface ControlsMessage {
    type: 'controls'
    controls: EngineControls
}

export type WorkletMessage = ReadyMessage | SnapshotMessage | ErrorMessage | ControlsMessage
