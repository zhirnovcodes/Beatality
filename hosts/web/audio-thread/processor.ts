// Audio thread. Command numbers match hosts/web/messages.ts.
// Served as one script, so this file imports nothing.

declare const sampleRate: number

const Play = 0
const Stop = 1
const Randomize = 2

interface Core {
    memory: WebAssembly.Memory
    _initialize?: () => void
    bt_alloc: (bytes: number) => number
    bt_free: (ptr: number) => void
    bt_create: (sampleRate: number, seed: number) => number
    bt_append: (engine: number, id: number, planar: number, frames: number) => number
    bt_command: (engine: number, type: number) => void
    bt_remove: (engine: number, index: number) => void
    bt_clear: (engine: number) => void
    bt_set_bpm: (engine: number, bpm: number) => void
    bt_set_loop: (engine: number, beats: number) => void
    bt_set_slice: (engine: number, exponent: number) => void
    bt_set_attack: (engine: number, ms: number) => void
    bt_set_track: (engine: number, index: number, start: number, length: number, loop: number) => void
    bt_render: (engine: number, left: number, right: number, frames: number) => void
    bt_snapshot: (engine: number) => void
    bt_snapshot_count: (engine: number) => number
    bt_snapshot_playing: (engine: number) => number
    bt_snapshot_slice_exp: (engine: number) => number
    bt_snapshot_loop: (engine: number) => number
    bt_snapshot_bpm: (engine: number) => number
    bt_snapshot_play_slot: (engine: number) => number
    bt_snapshot_play_track: (engine: number) => number
    bt_snapshot_released_count: (engine: number) => number
    bt_snapshot_released_id: (engine: number, index: number) => number
}

interface InitMessage {
    type: 'init'
    wasm: ArrayBuffer
    seed: number
}

interface AppendMessage {
    type: 'append'
    id: number
    frames: number
    planar: Float32Array
}

interface CommandMessage {
    type: 'command'
    command: number
}

interface RemoveMessage {
    type: 'remove'
    index: number
}

interface ClearMessage {
    type: 'clear'
}

interface BpmMessage {
    type: 'bpm'
    bpm: number
}

interface LoopMessage {
    type: 'loop'
    beats: number
}

interface SliceMessage {
    type: 'slice'
    exponent: number
}

interface AttackMessage {
    type: 'attack'
    ms: number
}

interface TrackMessage {
    type: 'track'
    index: number
    start: number
    length: number
    loop: boolean
}

interface FreeMessage {
    type: 'free'
    id: number
}

type HostMessage =
    | InitMessage
    | AppendMessage
    | CommandMessage
    | RemoveMessage
    | ClearMessage
    | BpmMessage
    | LoopMessage
    | SliceMessage
    | AttackMessage
    | TrackMessage
    | FreeMessage

interface WorkletPort {
    onmessage: ((event: { data: HostMessage }) => void) | null
    postMessage(message: unknown): void
}

declare class AudioWorkletProcessor {
    readonly port: WorkletPort
    constructor()
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void

class BeatalityProcessor extends AudioWorkletProcessor {
    private core: Core | null = null
    private engine = 0
    private owned = new Map<number, number>()
    private leftPtr = 0
    private rightPtr = 0
    private capacity = 0
    private outLeft: Float32Array | null = null
    private outRight: Float32Array | null = null
    private blocksLeft = 1
    private blocksPerSnapshot = 1
    private waiting: HostMessage[] = []

    constructor() {
        super()
        this.port.onmessage = (event) => {
            void this.onMessage(event.data)
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const channels = outputs[0]
        if (!channels || channels.length === 0) {
            return true
        }
        const frames = channels[0].length
        if (!this.core || this.engine === 0) {
            for (const channel of channels) {
                channel.fill(0)
            }
            return true
        }

        this.ensureRenderBuffers(frames)
        const core = this.core
        core.bt_render(this.engine, this.leftPtr, this.rightPtr, frames)
        const { left, right } = this.outputViews(frames)
        channels[0].set(left)
        if (channels.length > 1) {
            channels[1].set(right)
        }

        let peak = 0
        for (let i = 0; i < frames; i++) {
            let sampleL = channels[0][i]
            let sampleR = channels.length > 1 ? channels[1][i] : 0
            if (!Number.isFinite(sampleL)) {
                sampleL = channels[0][i] = 0
            }
            if (channels.length > 1 && !Number.isFinite(sampleR)) {
                sampleR = channels[1][i] = 0
            }
            peak = Math.max(peak, Math.abs(sampleL), Math.abs(sampleR))
        }
        if (--this.blocksLeft <= 0) {
            this.postSnapshot(peak)
            this.blocksLeft = this.blocksPerSnapshot
        }
        return true
    }

    private async onMessage(message: HostMessage) {
        if (message.type === 'init') {
            try {
                await this.init(message.wasm, message.seed)
                const pending = this.waiting
                this.waiting = []
                for (const queued of pending) {
                    this.handle(queued)
                }
            } catch (error) {
                this.port.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                })
            }
            return
        }
        if (!this.core) {
            this.waiting.push(message)
            return
        }
        this.handle(message)
    }

    private async init(wasm: ArrayBuffer, seed: number) {
        const { instance } = await WebAssembly.instantiate(wasm, {
            env: { emscripten_notify_memory_growth() {} },
        })
        const core = instance.exports as unknown as Core
        core._initialize?.()
        const engine = core.bt_create(sampleRate, seed >>> 0)
        if (engine === 0) {
            throw new Error('bt_create failed')
        }
        this.core = core
        this.engine = engine
        this.blocksPerSnapshot = Math.max(1, Math.round(sampleRate / 128 / 30))
        this.blocksLeft = this.blocksPerSnapshot
        this.port.postMessage({ type: 'ready' })
    }

    private handle(message: HostMessage) {
        if (message.type === 'append') {
            this.append(message)
        } else if (message.type === 'command') {
            if (message.command < Play || message.command > Randomize) {
                return
            }
            this.core!.bt_command(this.engine, message.command)
            this.postSnapshot(0)
        } else if (message.type === 'remove') {
            this.core!.bt_remove(this.engine, message.index)
            this.postSnapshot(0)
        } else if (message.type === 'clear') {
            this.core!.bt_clear(this.engine)
            this.postSnapshot(0)
        } else if (message.type === 'bpm') {
            this.core!.bt_set_bpm(this.engine, message.bpm)
            this.postSnapshot(0)
        } else if (message.type === 'loop') {
            this.core!.bt_set_loop(this.engine, message.beats)
            this.postSnapshot(0)
        } else if (message.type === 'slice') {
            this.core!.bt_set_slice(this.engine, message.exponent)
            this.postSnapshot(0)
        } else if (message.type === 'attack') {
            this.core!.bt_set_attack(this.engine, message.ms)
            this.postSnapshot(0)
        } else if (message.type === 'track') {
            this.core!.bt_set_track(this.engine, message.index, message.start, message.length, message.loop ? 1 : 0)
        } else if (message.type === 'free') {
            this.freeId(message.id)
        }
    }

    private append(message: AppendMessage) {
        const core = this.core!
        const ptr = core.bt_alloc(message.planar.length * 4)
        if (ptr === 0) {
            this.port.postMessage({ type: 'error', message: 'out of memory' })
            return
        }
        new Float32Array(core.memory.buffer, ptr, message.planar.length).set(message.planar)
        if (core.bt_append(this.engine, message.id, ptr, message.frames) === 0) {
            core.bt_free(ptr)
            this.port.postMessage({ type: 'error', message: 'append rejected' })
            return
        }
        this.owned.set(message.id, ptr)
        this.postSnapshot(0)
    }

    private freeId(id: number) {
        const ptr = this.owned.get(id)
        if (ptr === undefined || !this.core) {
            return
        }
        this.core.bt_free(ptr)
        this.owned.delete(id)
    }

    // A new view every block allocates on the audio thread. After a while the
    // collection pauses that thread and the browser repeats a short buffer,
    // which is a steady beep. Keep the views until the wasm memory moves.
    private outputViews(frames: number): { left: Float32Array; right: Float32Array } {
        const buffer = this.core!.memory.buffer
        const stale =
            !this.outLeft ||
            !this.outRight ||
            this.outLeft.buffer !== buffer ||
            this.outLeft.byteOffset !== this.leftPtr ||
            this.outLeft.length !== frames
        let left = this.outLeft
        let right = this.outRight
        if (stale || !left || !right) {
            left = new Float32Array(buffer, this.leftPtr, frames)
            right = new Float32Array(buffer, this.rightPtr, frames)
            this.outLeft = left
            this.outRight = right
        }
        return { left, right }
    }

    private ensureRenderBuffers(frames: number) {
        if (this.capacity >= frames) {
            return
        }
        const core = this.core!
        if (this.leftPtr !== 0) {
            core.bt_free(this.leftPtr)
        }
        if (this.rightPtr !== 0) {
            core.bt_free(this.rightPtr)
        }
        this.leftPtr = core.bt_alloc(frames * 4)
        this.rightPtr = core.bt_alloc(frames * 4)
        this.capacity = frames
    }

    private postSnapshot(peak: number) {
        const core = this.core
        if (!core || this.engine === 0) {
            return
        }
        core.bt_snapshot(this.engine)
        const releasedCount = core.bt_snapshot_released_count(this.engine)
        const released: number[] = []
        for (let i = 0; i < releasedCount; i++) {
            const id = core.bt_snapshot_released_id(this.engine, i)
            released.push(id)
            this.freeId(id)
        }
        this.port.postMessage({
            type: 'snapshot',
            count: core.bt_snapshot_count(this.engine),
            playing: core.bt_snapshot_playing(this.engine) === 1,
            sliceExp: core.bt_snapshot_slice_exp(this.engine),
            loopBeats: core.bt_snapshot_loop(this.engine),
            bpm: core.bt_snapshot_bpm(this.engine),
            playSlot: core.bt_snapshot_play_slot(this.engine),
            playTrack: core.bt_snapshot_play_track(this.engine),
            released,
            peak,
        })
    }
}

registerProcessor('beatality', BeatalityProcessor)
