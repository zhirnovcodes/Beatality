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

export interface TrackMessage {
    type: 'track'
    index: number
    start: number
    length: number
    loop: boolean
}

export interface FreeMessage {
    type: 'free'
    id: number
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
    | TrackMessage
    | FreeMessage

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
    released: number[]
    peak: number
}

export interface ErrorMessage {
    type: 'error'
    message: string
}

export type WorkletMessage = ReadyMessage | SnapshotMessage | ErrorMessage
