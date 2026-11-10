import { render } from 'preact'
import { EngineClient } from '../../../hosts/web/client/EngineClient'
import { MidiStatus } from '../../../hosts/web/messages'
import { chaosTriggerNames, decodeBanks, decodePack, type PackDocument, type PackTrack } from '../../../hosts/web/pack'
import { sourceDragType, type PluginEvent, type PluginFactory, type PluginInstance } from '../../../hosts/web/plugin'
import { BeatalityParameters } from '../../../presenters/web/BeatalityParameters'
import { WebPresenter } from '../../../presenters/web/WebPresenter'
import { WebViewModel } from '../../../viewmodels/web/WebViewModel'
import { Widget } from './Widget'
import './widget.css'
import wasmUrl from '../../../build-wasm/beatality.wasm?url'

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

// Beatality only, for the localhost test page. Not part of the plugin interface.
export interface BeatalityDev {
    // The current state as a pack with no sequence, and each track's original file. null when missing.
    // Each track's source id is its file name; the page swaps in the id the library stored it under.
    preset(name: string): { doc: PackDocument; files: (File | null)[] }
    // Re-reads /packs/banks.json into the bank picker.
    reloadBanks(): Promise<void>
}

export const beatality = {
    name: 'Beatality',

    async create(context: AudioContext, container: HTMLElement): Promise<PluginInstance & BeatalityDev> {
        const model = new WebViewModel()
        const client = new EngineClient({
            context,
            wasmUrl,
            processorUrl: '/beatality-processor.js',
        })
        const parameters = new BeatalityParameters(model)
        // Notes the host holds. A pack load releases them first.
        const held = new Set<number>()
        const drops = new Set<(source: string, parameter: string) => void>()

        const loadFactory = async (file: string): Promise<void> => {
            for (const note of held) {
                await client.midi(MidiStatus.Off, note, 0)
            }
            held.clear()
            const response = await fetch('/packs/' + file)
            if (!response.ok) {
                model.fail('could not load pack')
                return
            }
            const doc = decodePack(await response.text())
            if (!doc) {
                model.fail('could not load pack')
                return
            }
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
                const sample = await fetch('/packs/samples/' + encodeURIComponent(id))
                if (!sample.ok) {
                    return null
                }
                return new File([await sample.arrayBuffer()], id)
            })
            model.applyPack(doc)
        }

        const grid = document.createElement('div')
        grid.className = 'sample-grid'
        grid.setAttribute('role', 'listbox')
        grid.setAttribute('aria-label', 'Samples')
        const presenter = new WebPresenter(model, client, grid, loadFactory)

        const reloadBanks = async (): Promise<void> => {
            const response = await fetch('/packs/banks.json', { cache: 'no-store' })
            if (response.ok) {
                model.setFactoryBanks(decodeBanks(await response.json()))
            }
        }
        void reloadBanks().catch(() => {})

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

        render(
            <Widget
                model={model}
                grid={grid}
                bindPanel={(panel) => presenter.bindPanel(panel)}
                listenSelection={(listener) => presenter.listenSelection(listener)}
                chosen={() => presenter.chosen()}
            />,
            container,
        )

        // A drag from the wrapper lands on a control that names its parameter.
        const target = (event: DragEvent): string | null => {
            if (!event.dataTransfer?.types.includes(sourceDragType) || !(event.target instanceof Element)) {
                return null
            }
            return event.target.closest<HTMLElement>('[data-param]')?.dataset.param ?? null
        }
        const onDragOver = (event: DragEvent) => {
            if (target(event) !== null) {
                event.preventDefault()
            }
        }
        const onDrop = (event: DragEvent) => {
            const parameter = target(event)
            if (parameter === null) {
                return
            }
            event.preventDefault()
            const source = event.dataTransfer!.getData(sourceDragType)
            for (const listener of drops) {
                listener(source, parameter)
            }
        }
        container.addEventListener('dragover', onDragOver)
        container.addEventListener('drop', onDrop)

        const play = (event: PluginEvent) => {
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
            } else if (event.type === 'transport') {
                model.setProjectBpm(event.state.bpm)
                void client.transport(event.time, event.state)
            } else {
                model.setProjectBpm(event.bpm)
            }
        }

        return {
            audioInput: null,
            audioOutput: client.output,
            preset,
            reloadBanks,
            parameters: () => parameters.info(),
            parameter: (id) => parameters.value(id),
            // Notes and the transport land on their time in the audio thread. Automation applies when it arrives.
            schedule: (events) => {
                for (const event of events) {
                    play(event)
                }
            },
            // Beatality sends no events.
            listen: () => () => {},
            subscribe: (listener) => parameters.subscribe(listener),
            onDrop: (listener) => {
                drops.add(listener)
                return () => {
                    drops.delete(listener)
                }
            },
            dispose: () => {
                container.removeEventListener('dragover', onDragOver)
                container.removeEventListener('drop', onDrop)
                drops.clear()
                render(null, container)
                client.dispose()
            },
        }
    },
} satisfies PluginFactory
