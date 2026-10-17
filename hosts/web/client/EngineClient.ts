import { Command, type WorkletMessage } from '../messages'

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
import { AudioUnlock } from './AudioUnlock'
import { SampleDecoder, toPlanarStereo } from './SampleDecoder'
import { TrackRegistry } from './TrackRegistry'

export interface EngineSnapshot {
    count: number
    index: number
    playing: boolean
    position: number
    duration: number
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

    async play(): Promise<void> {
        await this.start()
        this.send(Command.Play)
    }

    async stop(): Promise<void> {
        await this.start()
        this.send(Command.Stop)
    }

    async randomize(): Promise<void> {
        await this.start()
        this.send(Command.Randomize)
    }

    async removeFirst(): Promise<void> {
        await this.start()
        if (this.registry.count === 0) {
            return
        }
        this.registry.removeFirst()
        this.send(Command.RemoveFirst)
        this.emitList()
    }

    // Decodes every file, skips the ones that fail, then one Randomize for the batch.
    // An empty list is a cancelled dialog: the engine is left untouched.
    async append(files: readonly File[]): Promise<void> {
        if (files.length === 0) {
            return
        }
        await this.start()
        const decoded: { name: string; frames: number; planar: Float32Array }[] = []
        for (const file of files) {
            if (this.registry.count + decoded.length >= TrackRegistry.capacity) {
                break
            }
            const audio = await this.decoder!.decode(file)
            if (!audio) {
                continue
            }
            decoded.push({ name: file.name, frames: audio.length, planar: toPlanarStereo(audio) })
        }
        for (const item of decoded) {
            const id = this.registry.add(item.name)
            if (id === null || !this.node) {
                break
            }
            this.node.port.postMessage(
                { type: 'append', id, frames: item.frames, planar: item.planar },
                [item.planar.buffer],
            )
        }
        if (decoded.length > 0) {
            this.send(Command.Randomize)
        }
        this.emitList()
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
            index: message.index,
            playing: message.playing,
            position: message.position,
            duration: message.duration,
            names: this.registry.list(),
            peak: message.peak,
        }
        this.latest = snapshot
        this.onSnapshot?.(snapshot)
    }

    private send(command: number) {
        this.node?.port.postMessage({ type: 'command', command })
    }

    // Names change on this thread, before the audio thread has answered.
    // The chosen index stays unknown until that answer arrives.
    private emitList() {
        const snapshot: EngineSnapshot = {
            count: this.registry.count,
            index: -1,
            playing: this.registry.count > 0 && (this.latest?.playing ?? false),
            position: this.latest?.position ?? 0,
            duration: this.latest?.duration ?? 0,
            names: this.registry.list(),
            peak: this.latest?.peak ?? 0,
        }
        this.latest = snapshot
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
