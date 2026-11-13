import { EngineClient } from '../../../hosts/web/client/EngineClient'
import { MidiStatus } from '../../../hosts/web/messages'
import { chaosTriggerNames, decodeBanks, decodePack, type PackDocument, type PackTrack } from '../../../hosts/web/pack'
import { BeatalityParameters } from '../../../presenters/web/BeatalityParameters'
import { WebViewModel } from '../../../viewmodels/web/WebViewModel'

// Where the engine's files live. The widget page uses root paths; the DAW build resolves them against its module.
export interface CoreUrls {
    processor: string
    wasm: string
    pack: (file: string) => string
    // Encodes the id itself.
    sample: (id: string) => string
    banks: string
}

export interface CoreOptions {
    // See EngineClientOptions.resumeContext.
    resumeContext: boolean
}

// The events both plugin APIs share. time is in the context's seconds.
export type CoreEvent =
    | { type: 'midi'; time: number; bytes: readonly [number, number, number] }
    | { type: 'automation'; id: string; value: number }
    | { type: 'tempo'; bpm: number }

// The engine, the model, and the pack handling, with no UI. Both plugin entries build on it.
export interface BeatalityCore {
    readonly model: WebViewModel
    readonly client: EngineClient
    readonly parameters: BeatalityParameters
    // Releases held notes, then loads a factory pack by file name.
    loadFactory(file: string): Promise<void>
    // Releases held notes, then loads the document.
    loadDocument(doc: PackDocument): Promise<void>
    // The current state as a pack with no sequence, and each track's original file. null when missing.
    preset(name: string): { doc: PackDocument; files: (File | null)[] }
    // Re-reads the bank list into the bank picker.
    reloadBanks(): Promise<void>
    play(event: CoreEvent): void
    dispose(): void
}

// Note on, note off, and all notes off. The engine treats any note as the gate.
function gateOf(bytes: readonly [number, number, number]): { status: number; note: number; velocity: number } | null {
    const kind = bytes[0] & 0xf0
    if (kind === 0x90 && bytes[2] > 0) {
        return { status: MidiStatus.On, note: bytes[1], velocity: bytes[2] / 127 }
    }
    if (kind === 0x80 || kind === 0x90) {
        return { status: MidiStatus.Off, note: bytes[1], velocity: 0 }
    }
    if (kind === 0xb0 && (bytes[1] === 120 || bytes[1] === 123)) {
        return { status: MidiStatus.AllOff, note: 0, velocity: 0 }
    }
    return null
}

export function createCore(context: AudioContext, urls: CoreUrls, options: CoreOptions = { resumeContext: true }): BeatalityCore {
    const model = new WebViewModel()
    const client = new EngineClient({ context, wasmUrl: urls.wasm, processorUrl: urls.processor, resumeContext: options.resumeContext })
    const parameters = new BeatalityParameters(model)
    // Notes the host holds. A pack load releases them first.
    const held = new Set<number>()

    const loadDocument = async (doc: PackDocument): Promise<void> => {
        for (const note of held) {
            await client.midi(MidiStatus.Off, note, 0)
        }
        held.clear()
        model.adopt({
            bpm: doc.bpm,
            loopBeats: doc.loop,
            sliceExp: doc.slices,
            attackMs: doc.attack,
            outputVolume: doc.volume,
            outputPanMin: doc.panMin,
            outputPanMax: doc.panMax,
        })
        // Sync first: it decides the tempo the install sends.
        model.setBpmSync(doc.bpmSync)
        // The pack's tempo is the widget's own. While synced the engine keeps the project's.
        await client.loadDocument({ ...doc, bpm: model.engineBpm }, async (id) => {
            const sample = await fetch(urls.sample(id))
            if (!sample.ok) {
                return null
            }
            return new File([await sample.arrayBuffer()], id)
        })
        model.applyPack(doc)
    }

    const loadFactory = async (file: string): Promise<void> => {
        const response = await fetch(urls.pack(file))
        const doc = response.ok ? decodePack(await response.text()) : null
        if (!doc) {
            model.fail('could not load pack')
            return
        }
        await loadDocument(doc)
    }

    const reloadBanks = async (): Promise<void> => {
        const response = await fetch(urls.banks, { cache: 'no-store' })
        if (response.ok) {
            model.setFactoryBanks(decodeBanks(await response.json()))
        }
    }

    const preset = (name: string): { doc: PackDocument; files: (File | null)[] } => {
        const tracks: PackTrack[] = []
        const files: (File | null)[] = []
        for (let index = 0; index < client.registry.count; index++) {
            const play = client.registry.playAt(index)
            const file = client.registry.fileAt(index)
            if (!play) {
                continue
            }
            tracks.push({ source: { type: 'internal', id: file?.name ?? 'missing' }, ...play })
            files.push(file)
        }
        const doc: PackDocument = {
            format: 'beatality.pack',
            version: 1,
            name,
            bpm: model.bpm,
            loop: model.loopBeats,
            slices: model.sliceExp,
            attack: model.attackMs,
            volume: model.outputVolume,
            panMin: model.outputPanMin,
            panMax: model.outputPanMax,
            bpmSync: model.bpmSync,
            retrig: model.retrig,
            effects: {
                enabled: model.effectsEnabled,
                globalPower: model.globalPower,
                globalChance: model.globalChance,
                beatMin: model.globalBeatMinExp,
                beatMax: model.globalBeatMaxExp,
                delayPower: model.delayPower,
                delayChance: model.delayChance,
                reverbPower: model.reverbPower,
                reverbChance: model.reverbChance,
                reversePower: model.reversePower,
                reverseChance: model.reverseChance,
                filterPower: model.filterPower,
                filterChance: model.filterChance,
                flangerPower: model.flangerPower,
                flangerChance: model.flangerChance,
                trancePower: model.trancePower,
                tranceChance: model.tranceChance,
                shiftPower: model.shiftPower,
                shiftChance: model.shiftChance,
            },
            repeat: {
                enabled: model.repeatEnabled,
                sizeMin: model.repeatSizeMinExp,
                sizeMax: model.repeatSizeMaxExp,
                length: model.repeatLengthExp,
                chance: model.repeatChance,
                mix: model.repeatMix,
                positions: [...model.repeatPositions],
            },
            chaos: {
                trigger: chaosTriggerNames[model.chaosTrigger] ?? 'none',
                value: model.chaosValue,
                beatSize: model.chaosBeatSize,
                loopSize: model.chaosLoopSize,
                sliceSize: model.chaosSliceSize,
                groups: [...model.chaosGroups],
            },
            // No sequence: a fresh one is rolled on load.
            sequence: { savedCount: 0, slots: [] },
            tracks,
        }
        return { doc, files }
    }

    const play = (event: CoreEvent) => {
        if (event.type === 'midi') {
            const gate = gateOf(event.bytes)
            if (!gate) {
                return
            }
            if (gate.status === MidiStatus.On) {
                held.add(gate.note)
            } else if (gate.status === MidiStatus.Off) {
                held.delete(gate.note)
            } else {
                held.clear()
            }
            void client.midi(gate.status, gate.note, gate.velocity, event.time)
        } else if (event.type === 'automation') {
            parameters.set(event.id, event.value)
        } else {
            model.setProjectBpm(event.bpm)
        }
    }

    return {
        model,
        client,
        parameters,
        loadFactory,
        loadDocument,
        preset,
        reloadBanks,
        play,
        dispose: () => {
            held.clear()
            client.dispose()
        },
    }
}
