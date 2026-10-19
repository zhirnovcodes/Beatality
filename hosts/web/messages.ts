// Messages between the page and the AudioWorklet. The processor repeats the
// command numbers and the message shapes so that it can be served as one script.

export const Command = {
    Play: 0,
    Stop: 1,
    Randomize: 2,
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

export interface CommandMessage {
    type: 'command'
    command: number
}

export interface RemoveMessage {
    type: 'remove'
    index: number
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

export interface FreeMessage {
    type: 'free'
    id: number
}

export type HostMessage =
    | InitMessage
    | AppendMessage
    | CommandMessage
    | RemoveMessage
    | BpmMessage
    | LoopMessage
    | SliceMessage
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
    released: number[]
    peak: number
}

export interface ErrorMessage {
    type: 'error'
    message: string
}

export type WorkletMessage = ReadyMessage | SnapshotMessage | ErrorMessage
