import type { ChaosFields, EngineControls, PackMessage, TrackMessage, WorkletMessage } from '../messages'
import { sampleBpm, warpIndex, type PackDocument, type SampleSettings } from '../pack'

function trackMessage(index: number, play: SampleSettings): TrackMessage {
    return {
        type: 'track',
        index,
        start: play.start,
        length: play.length,
        loop: play.loop,
        volume: play.volume,
        pan: play.pan,
        warp: warpIndex(play.warp),
        bpm: play.bpm,
        warpParam: play.warpParam,
    }
}

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
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
    missing: boolean[]
    peak: number
}

export interface EngineClientOptions {
    // The host's context. Several clients can share one.
    context: AudioContext
    wasmUrl: string
    processorUrl: string
}

// The page's handle on the audio thread. Safe to call before audio has started:
// the first call resumes the AudioContext, so it has to happen inside a click.
export class EngineClient {
    readonly registry = new TrackRegistry()
    // The engine plays into this. The host connects it onward. It exists before the engine starts.
    readonly output: GainNode
    latest: EngineSnapshot | null = null
    onSnapshot: ((snapshot: EngineSnapshot) => void) | null = null
    // The knobs after a chaos roll changed them.
    onControls: ((controls: EngineControls) => void) | null = null
    onError: ((message: string) => void) | null = null

    private decoder: SampleDecoder | null = null
    private node: AudioWorkletNode | null = null
    private started = false
    private disposed = false
    private starting: Promise<void> | null = null
    private ready!: Promise<void>
    private markReady!: () => void
    private failReady!: (error: Error) => void

    constructor(private readonly options: EngineClientOptions) {
        this.output = options.context.createGain()
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

    // The plugin was closed. Stops the audio thread and lets go of the output.
    dispose() {
        this.disposed = true
        this.onSnapshot = null
        this.onControls = null
        this.onError = null
        this.output.disconnect()
        if (this.node) {
            this.node.port.postMessage({ type: 'dispose' })
            this.node.port.onmessage = null
            this.node.disconnect()
            this.node = null
        }
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

    async setGlobalPower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'globalPower', power })
    }

    async setEffectsEnabled(on: boolean): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'effectsEnabled', on })
    }

    async setRetrig(on: boolean): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'retrig', on })
    }

    async setGlobalBeatRange(min: number, max: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'globalBeatRange', min, max })
    }

    async setGlobalChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'globalChance', chance })
    }

    async setReverbPower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'reverbPower', power })
    }

    async setReverbChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'reverbChance', chance })
    }

    async setDelayPower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'delayPower', power })
    }

    async setDelayChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'delayChance', chance })
    }

    async setReversePower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'reversePower', power })
    }

    async setReverseChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'reverseChance', chance })
    }

    async setFilterPower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'filterPower', power })
    }

    async setFilterChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'filterChance', chance })
    }

    async setFlangerPower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'flangerPower', power })
    }

    async setFlangerChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'flangerChance', chance })
    }

    async setTrancePower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'trancePower', power })
    }

    async setTranceChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'tranceChance', chance })
    }

    async setShiftPower(power: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'shiftPower', power })
    }

    async setShiftChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'shiftChance', chance })
    }

    async setRepeatEnabled(on: boolean): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'repeatEnabled', on })
    }

    async setRepeatSizeRange(min: number, max: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'repeatSizeRange', min, max })
    }

    async setRepeatLength(exponent: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'repeatLength', exponent })
    }

    async setRepeatChance(chance: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'repeatChance', chance })
    }

    async setRepeatPosition(index: number, on: boolean): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'repeatPosition', index, on })
    }

    async setRepeatMix(mix: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'repeatMix', mix })
    }

    async setChaos(chaos: ChaosFields): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'chaos', ...chaos, groups: [...chaos.groups] })
    }

    async setTrack(index: number, play: SampleSettings): Promise<void> {
        await this.start()
        this.node?.port.postMessage(trackMessage(index, play))
    }

    async setOutput(volume: number, panMin: number, panMax: number): Promise<void> {
        await this.start()
        this.node?.port.postMessage({ type: 'output', volume, panMin, panMax })
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

    // Resolves each address, then stops playback and installs the pack.
    // A file path cannot be opened here, so that slot stays empty.
    async loadDocument(doc: PackDocument, openInternal: (id: string) => Promise<File | null>): Promise<void> {
        await this.start()
        const tracks: PackInstallTrack[] = []
        for (const track of doc.tracks) {
            const play: SampleSettings = {
                start: track.start,
                length: track.length,
                loop: track.loop,
                volume: track.volume,
                pan: track.pan,
                warp: track.warp,
                bpm: track.bpm,
                warpParam: track.warpParam,
            }
            const name = track.source.type === 'internal' ? track.source.id : baseName(track.source.path)
            const file = track.source.type === 'internal' ? await openInternal(track.source.id) : null
            const audio = file ? await this.decoder!.decode(file) : null
            if (!audio) {
                const empty = new Float32Array(0)
                tracks.push({
                    name,
                    file: null,
                    missing: true,
                    play,
                    frames: 0,
                    planar: null,
                    left: empty,
                    right: empty,
                    sampleRate: 0,
                })
                continue
            }
            const planar = toPlanarStereo(audio)
            const channels = channelCopies(planar, audio.length)
            tracks.push({
                name: file?.name || name,
                file,
                missing: false,
                play,
                frames: audio.length,
                planar,
                left: channels.left,
                right: channels.right,
                sampleRate: audio.sampleRate,
            })
        }
        await this.applyPack({
            bpm: doc.bpm,
            loop: doc.loop,
            slices: doc.slices,
            attack: doc.attack,
            volume: doc.volume,
            panMin: doc.panMin,
            panMax: doc.panMax,
            savedCount: doc.sequence.savedCount,
            slots: doc.sequence.slots,
            tracks,
        })
    }

    // Stops playback, replaces the bank, then installs the sequence.
    async applyPack(install: PackInstall): Promise<void> {
        await this.start()
        this.registry.clear()
        const tracks: PackMessage['tracks'] = []
        const transfers: ArrayBuffer[] = []
        for (const track of install.tracks) {
            const id = this.registry.add(
                track.name,
                { samples: track.left, right: track.right, sampleRate: track.sampleRate },
                track.missing,
                track.play,
                track.file,
            )
            if (id === null) {
                break
            }
            const planar = track.planar ?? new Float32Array(0)
            tracks.push({
                id,
                missing: track.missing,
                frames: track.frames,
                planar,
                start: track.play.start,
                length: track.play.length,
                loop: track.play.loop,
                volume: track.play.volume,
                pan: track.play.pan,
                warp: warpIndex(track.play.warp),
                bpm: track.play.bpm,
                warpParam: track.play.warpParam,
            })
            if (!track.missing && track.planar) {
                transfers.push(track.planar.buffer as ArrayBuffer)
            }
        }
        this.node?.port.postMessage(
            {
                type: 'pack',
                bpm: install.bpm,
                loop: install.loop,
                slices: install.slices,
                attack: install.attack,
                volume: install.volume,
                panMin: install.panMin,
                panMax: install.panMax,
                savedCount: install.savedCount,
                slots: install.slots,
                tracks,
            },
            transfers,
        )
        this.emitList(false)
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
        const context = this.options.context
        if (context.state !== 'running') {
            await context.resume()
        }
        const wasmResponse = await fetch(this.options.wasmUrl)
        if (!wasmResponse.ok) {
            throw new Error(`could not load ${this.options.wasmUrl}`)
        }
        const [wasm] = await Promise.all([
            wasmResponse.arrayBuffer(),
            context.audioWorklet.addModule(this.options.processorUrl),
        ])
        // Closed while the engine was loading.
        if (this.disposed) {
            throw new DOMException('disposed', 'AbortError')
        }
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
        this.node.connect(this.output)
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
        if (message.type === 'controls') {
            this.onControls?.(message.controls)
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
            missing: this.registry.missingList(),
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
                file,
                frames: audio.length,
                planar,
                left: channels.left,
                right: channels.right,
                sampleRate: audio.sampleRate,
            })
        }
        return decoded
    }

    // A new file takes the project tempo as its own, so it plays unchanged until its BPM is edited.
    private sendDecoded(decoded: readonly DecodedTrack[]) {
        for (const item of decoded) {
            const play = { ...TrackRegistry.defaultPlay, bpm: sampleBpm(this.latest?.bpm ?? 120) }
            const id = this.registry.add(
                item.name,
                { samples: item.left, right: item.right, sampleRate: item.sampleRate },
                false,
                play,
                item.file,
            )
            if (id === null || !this.node) {
                break
            }
            this.node.port.postMessage(
                { type: 'append', id, frames: item.frames, planar: item.planar },
                [item.planar.buffer],
            )
            this.node.port.postMessage(trackMessage(this.registry.count - 1, play))
        }
    }

    // Names change on this thread, before the audio thread has answered.
    // Playing follows the list. The slice stays until a real snapshot reports it.
    private emitList(playing?: boolean) {
        const isPlaying = playing ?? (this.registry.count > 0 && (this.latest?.playing ?? false))
        const snapshot: EngineSnapshot = {
            count: this.registry.count,
            playing: isPlaying,
            sliceExp: null,
            loopBeats: this.latest?.loopBeats ?? 8,
            bpm: this.latest?.bpm ?? 120,
            playSlot: this.latest?.playSlot ?? -1,
            playTrack: this.latest?.playTrack ?? -1,
            playhead: isPlaying ? (this.latest?.playhead ?? 0) : 0,
            names: this.registry.list(),
            missing: this.registry.missingList(),
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

export interface PackInstallTrack {
    name: string
    // The file it was decoded from. Null when missing.
    file: File | null
    missing: boolean
    play: SampleSettings
    frames: number
    planar: Float32Array | null
    left: Float32Array
    right: Float32Array
    sampleRate: number
}

export interface PackInstall {
    bpm: number
    loop: number
    slices: number
    attack: number
    volume: number
    panMin: number
    panMax: number
    savedCount: number
    slots: number[]
    tracks: PackInstallTrack[]
}

interface DecodedTrack {
    name: string
    file: File
    frames: number
    planar: Float32Array
    left: Float32Array
    right: Float32Array
    sampleRate: number
}

// Copies both channels. The planar buffer is transferred to the audio thread;
// the image keeps reading these copies.
function baseName(path: string): string {
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const name = slash >= 0 ? path.slice(slash + 1) : path
    return name || 'track'
}

function channelCopies(planar: Float32Array, frames: number): { left: Float32Array; right: Float32Array } {
    return {
        left: new Float32Array(planar.subarray(0, frames)),
        right: new Float32Array(planar.subarray(frames, frames * 2)),
    }
}
