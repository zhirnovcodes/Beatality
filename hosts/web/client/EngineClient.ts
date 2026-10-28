import type { WorkletMessage } from '../messages'

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
import { AudioUnlock } from './AudioUnlock'
import { SampleDecoder, toPlanarStereo } from './SampleDecoder'
import { TrackRegistry } from './TrackRegistry'

export interface EngineSnapshot {
    count: number
    playing: boolean
    // Null when this snapshot only refreshed the names, before the audio thread answered.
    sliceExp: number | null
    loopBeats: number
    bpm: number
    playSlot: number
    playTrack: number
    playhead: number
    names: string[]
    peak: number
}

export interface EngineClientOptions {
    wasmUrl: string
    processorUrl: string
}

// The page's handle on the audio thread. Safe to call before audio has started:
// the first call resumes the AudioContext, so it has to happen inside a click.
export class EngineClient {
    readonly registry = new TrackRegistry()
    latest: EngineSnapshot | null = null
    onSnapshot: ((snapshot: EngineSnapshot) => void) | null = null
    onError: ((message: string) => void) | null = null

    private readonly unlock = new AudioUnlock()
    private decoder: SampleDecoder | null = null
    private node: AudioWorkletNode | null = null
    private started = false
    private starting: Promise<void> | null = null
    private ready!: Promise<void>
    private markReady!: () => void
    private failReady!: (error: Error) => void

    constructor(private readonly options: EngineClientOptions) {
        this.resetReady()
    }

    start(): Promise<void> {
        if (!this.starting) {
            this.starting = this.startInner().catch((error: unknown) => {
                this.starting = null
                if (!isAbort(error)) {
                    const message = error instanceof Error ? error.message : String(error)
                    this.onError?.(message)
                }
                throw error
            })
        }
        return this.starting
    }

    async midi(status: number, note: number, velocity: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'midi', frame: 0, status, note, velocity })
    }

    async randomize(): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'randomize' })
    }

    async removeAt(index: number): Promise<void> {
        await this.start()
        if (index < 0 || index >= this.registry.count) {
            return
        }
        this.registry.removeAt(index)
        this.node?.port.postMessage({ type: 'remove', index })
        this.emitList()
    }

    async setBpm(bpm: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'bpm', bpm })
    }

    async setLoop(beats: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'loop', beats })
    }

    async setSlice(exponent: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'slice', exponent })
    }

    async setAttack(ms: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'attack', ms })
    }

    async setTrack(
        index: number,
        start: number,
        length: number,
        loop: boolean,
        volume: number,
        pan: number,
    ): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'track', index, start, length, loop, volume, pan })
    }

    async setOutput(volume: number, pan: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'output', volume, pan })
    }

    // Empties the bank. A sounding voice fades out.
    async clear(): Promise<void> {
        await this.start()
        this.registry.clear()
        this.node?.port.postMessage({ type: 'clear' })
        this.emitList()
    }

    // Decodes every file and appends the ones that decode. Returns how many were
    // added. Does not pick a sample. An empty list leaves the engine untouched.
    async append(files: readonly File[]): Promise<number> {
        if (files.length === 0) {
            return 0
        }
        await this.start()
        const decoded = await this.decodeFiles(files, TrackRegistry.capacity - this.registry.count)
        this.sendDecoded(decoded)
        this.emitList()
        return decoded.length
    }

    // Once the files have decoded, replaces the bank with them.
    // A file that does not decode is skipped. If none decode, the bank stays.
    // Returns how many were added. clear() fades a live voice.
    async replace(files: readonly File[]): Promise<number> {
        if (files.length === 0) {
            return 0
        }
        await this.start()
        const decoded = await this.decodeFiles(files, TrackRegistry.capacity)
        if (decoded.length === 0) {
            return 0
        }
        this.registry.clear()
        this.node?.port.postMessage({ type: 'clear' })
        this.sendDecoded(decoded)
        this.emitList()
        return decoded.length
    }

    private async startInner(): Promise<void> {
        const context = await this.unlock.resume()
        const wasmResponse = await fetch(this.options.wasmUrl)
        if (!wasmResponse.ok) {
            throw new Error(`could not load ${this.options.wasmUrl}`)
        }
        const [wasm] = await Promise.all([
            wasmResponse.arrayBuffer(),
            context.audioWorklet.addModule(this.options.processorUrl),
        ])
        this.decoder = new SampleDecoder(context)
        // No input: the node only plays what the engine renders. A live input
        // would be mixed back in by the browser and howl after a while.
        this.node = new AudioWorkletNode(context, 'beatality', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            channelInterpretation: 'discrete',
        })
        this.node.connect(context.destination)
        this.node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
            this.onWorklet(event.data)
        }
        const seed = (Math.random() * 0x100000000) >>> 0
        this.node.port.postMessage({ type: 'init', wasm, seed }, [wasm])
        await this.ready
        this.started = true
    }

    private onWorklet(message: WorkletMessage) {
        if (message.type === 'ready') {
            this.markReady()
            return
        }
        if (message.type === 'error') {
            // Startup failures reject start() and the caller reports them.
            // Later failures have no caller waiting, so they are reported here.
            this.failReady(new Error(message.message))
            if (this.started) {
                this.onError?.(message.message)
            }
            return
        }
        const snapshot: EngineSnapshot = {
            count: message.count,
            playing: message.playing,
            sliceExp: message.sliceExp,
            loopBeats: message.loopBeats,
            bpm: message.bpm,
            playSlot: message.playSlot,
            playTrack: message.playTrack,
            playhead: message.playhead,
            names: this.registry.list(),
            peak: message.peak,
        }
        this.latest = snapshot
        this.onSnapshot?.(snapshot)
    }

    private async decodeFiles(files: readonly File[], room: number): Promise<DecodedTrack[]> {
        const decoded: DecodedTrack[] = []
        for (const file of files) {
            if (decoded.length >= room) {
                break
            }
            const audio = await this.decoder!.decode(file)
            if (!audio) {
                continue
            }
            const planar = toPlanarStereo(audio)
            const channels = channelCopies(planar, audio.length)
            decoded.push({
                name: file.name,
                frames: audio.length,
                planar,
                left: channels.left,
                right: channels.right,
                sampleRate: audio.sampleRate,
            })
        }
        return decoded
    }

    private sendDecoded(decoded: readonly DecodedTrack[]) {
        for (const item of decoded) {
            const id = this.registry.add(item.name, {
                samples: item.left,
                right: item.right,
                sampleRate: item.sampleRate,
            })
            if (id === null || !this.node) {
                break
            }
            this.node.port.postMessage(
                { type: 'append', id, frames: item.frames, planar: item.planar },
                [item.planar.buffer],
            )
        }
    }

    // Names change on this thread, before the audio thread has answered.
    // Playing follows the list. The slice stays until a real snapshot reports it.
    private emitList() {
        const snapshot: EngineSnapshot = {
            count: this.registry.count,
            playing: this.registry.count > 0 && (this.latest?.playing ?? false),
            sliceExp: null,
            loopBeats: this.latest?.loopBeats ?? 8,
            bpm: this.latest?.bpm ?? 120,
            playSlot: this.latest?.playSlot ?? -1,
            playTrack: this.latest?.playTrack ?? -1,
            playhead: this.registry.count > 0 ? (this.latest?.playhead ?? 0) : 0,
            names: this.registry.list(),
            peak: this.latest?.peak ?? 0,
        }
        this.latest = { ...snapshot, sliceExp: this.latest?.sliceExp ?? null }
        this.onSnapshot?.(snapshot)
    }

    private resetReady() {
        this.ready = new Promise<void>((resolve, reject) => {
            this.markReady = resolve
            this.failReady = reject
        })
        // A start() failure rejects this promise. Later snapshot errors must not
        // surface as an unhandled rejection once startup has already settled.
        this.ready.catch(() => {})
    }
}

interface DecodedTrack {
    name: string
    frames: number
    planar: Float32Array
    left: Float32Array
    right: Float32Array
    sampleRate: number
}

// Copies both channels. The planar buffer is transferred to the audio thread;
// the image keeps reading these copies.
function channelCopies(planar: Float32Array, frames: number): { left: Float32Array; right: Float32Array } {
    return {
        left: new Float32Array(planar.subarray(0, frames)),
        right: new Float32Array(planar.subarray(frames, frames * 2)),
    }
}
