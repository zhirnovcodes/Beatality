import { render } from 'preact'
import { decodePack, type PackDocument } from '../../../hosts/web/pack'
import type {
    HostContext,
    ParameterChange,
    PluginEvent,
    PluginFactory,
    PluginInstance,
    PluginState,
    PortHandle,
    PortInfo,
    TransportState,
} from '../../../hosts/web/plugin-v2'
import { WebPresenter } from '../../../presenters/web/WebPresenter'
import { createCore } from './beatalityCore'
import { defaultPack, manifest } from './dawManifest'
import { ChangeSources, dawParameter, isTrigger } from './dawParameters'
import { Widget } from './Widget'
import skinCss from './ui/skin/skin.css?inline'
import widgetCss from './widget.css?inline'

// Beatality for IvanDAW: the Web Plugin API v2 entry. The widget page and the rack keep using plugin.tsx.

// One style element per document, shared by every instance. All rules sit under .beatality-skin.
const styles = new Map<Document, { element: HTMLStyleElement; users: number }>()

function holdStyles(doc: Document): () => void {
    let entry = styles.get(doc)
    if (!entry) {
        const element = doc.createElement('style')
        element.dataset.beatality = ''
        element.textContent = skinCss + '\n' + widgetCss
        doc.head.append(element)
        entry = { element, users: 0 }
        styles.set(doc, entry)
    }
    entry.users++
    const held = entry
    return () => {
        held.users--
        if (held.users === 0) {
            held.element.remove()
            styles.delete(doc)
        }
    }
}

// The pack a document holds, or an error that names what is wrong.
async function fetchPack(url: string): Promise<PackDocument> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`could not load ${url}`)
    }
    const doc = decodePack(await response.text())
    if (!doc) {
        throw new Error(`not a Beatality pack: ${url}`)
    }
    return doc
}

function portInfo<K extends PortInfo['kind']>(id: string, kind: K): PortInfo & { kind: K } {
    const info = manifest.ports.find((port) => port.id === id && port.kind === kind)
    if (!info) {
        throw new Error(`manifest has no ${kind} port ${id}`)
    }
    return info as PortInfo & { kind: K }
}

const factory: PluginFactory = {
    manifest,

    async create(host: HostContext, container: HTMLElement | null): Promise<PluginInstance> {
        const core = createCore(host.audioContext, {
            processor: host.assetUrl('processor.js'),
            wasm: host.assetUrl('beatality.wasm'),
            pack: (file) => host.assetUrl('packs/' + file),
            sample: (id) => host.assetUrl('packs/samples/' + encodeURIComponent(id)),
            banks: host.assetUrl('packs/banks.json'),
        }, {
            // The DAW owns the context and starts it. Waiting on resume() would hang create() until a click.
            resumeContext: false,
        })
        const { model, client, parameters } = core

        // The presenter carries every model change to the engine, so it lives as long as the instance.
        // Its sample grid stays detached until the widget is mounted.
        const grid = document.createElement('div')
        grid.className = 'sample-grid'
        grid.setAttribute('role', 'listbox')
        grid.setAttribute('aria-label', 'Samples')
        const presenter = new WebPresenter(model, client, grid, async (file) => {
            await core.loadFactory(file)
            host.markDirty()
        })

        try {
            await core.reloadBanks()
        } catch {
            // The bank picker stays empty. Playing does not need it.
        }
        try {
            await core.loadDocument(await fetchPack(host.assetUrl('packs/' + defaultPack)))
        } catch (error) {
            core.dispose()
            throw error
        }

        // Defaults are what the default pack sets.
        const infos = parameters.info().map((info) => dawParameter(info, parameters.value(info.id)))

        const sources = new ChangeSources()
        const listeners = new Set<(change: ParameterChange) => void>()
        const stopParameters = parameters.subscribe((id, value) => {
            const change = sources.change(id, value)
            if (!change) {
                return
            }
            if (change.source === 'ui') {
                host.markDirty()
            }
            for (const listener of listeners) {
                listener(change)
            }
        })

        // With retrig off a note sounds only while the project plays, from the project's position,
        // so the engine needs the transport. v2 gives no seconds; they are counted along the beats
        // at the tempo each stretch played at, which keeps tempo changes from reading as jumps.
        let last: { beat: number; bpm: number; seconds: number } | null = null
        const transport = (time: number, state: TransportState) => {
            if (!(state.bpm > 0) || !Number.isFinite(state.beat)) {
                return
            }
            const seconds = last ? last.seconds + ((state.beat - last.beat) * 60) / last.bpm : (state.beat * 60) / state.bpm
            last = { beat: state.beat, bpm: state.bpm, seconds }
            model.setProjectBpm(state.bpm)
            void client.transport(time, { playing: state.playing, bpm: state.bpm, beat: state.beat, seconds })
        }
        // An instance added while the project already plays.
        transport(host.audioContext.currentTime, host.transport())

        const play = (event: PluginEvent) => {
            if (event.type === 'midi') {
                core.play(event)
            } else if (event.type === 'automation') {
                // ParameterChange has no 'clip' source; a clip is the host playing automation.
                sources.during(event.source === 'binding' ? 'binding' : 'host', () => core.play({ type: 'automation', id: event.id, value: event.value }))
            } else if (event.type === 'tempo') {
                // Only the project tempo. BPM sync stays as the pack set it.
                core.play({ type: 'tempo', bpm: event.bpm })
            } else {
                transport(event.time, event.state)
            }
        }

        // The widget is rendered once, into root, on the first mount. Unmount detaches root and keeps the tree,
        // so a remount shows the same panel, selection, and values.
        let root: HTMLDivElement | null = null
        let releaseStyles: (() => void) | null = null
        const mount = (target: HTMLElement) => {
            if (!releaseStyles) {
                releaseStyles = holdStyles(target.ownerDocument)
            }
            if (!root) {
                root = target.ownerDocument.createElement('div')
                root.className = 'beatality-daw'
                target.append(root)
                render(
                    <Widget
                        model={model}
                        grid={grid}
                        bindPanel={(panel) => presenter.bindPanel(panel)}
                        listenSelection={(listener) => presenter.listenSelection(listener)}
                        chosen={() => presenter.chosen()}
                    />,
                    root,
                )
                return
            }
            target.append(root)
        }
        const unmount = () => {
            root?.remove()
        }

        const ports = new Map<string, PortHandle>([
            ['in', { info: portInfo('in', 'events') }],
            ['out', { info: portInfo('out', 'audio'), node: client.output, index: 0 }],
        ])

        if (container) {
            mount(container)
        }

        return {
            ports,
            latency: 0,
            // Closing the gate stops the effects too, so nothing plays on after the last note off.
            tail: 0,
            parameters: () => infos,
            parameter: (id) => (isTrigger(id) ? 0 : parameters.value(id)),
            // Events apply when they arrive; notes land on their time in the audio thread.
            schedule: (events) => {
                for (const event of events) {
                    play(event)
                }
            },
            // Beatality sends no events.
            listen: () => () => {},
            subscribe: (listener) => {
                listeners.add(listener)
                return () => {
                    listeners.delete(listener)
                }
            },
            getState: async (): Promise<PluginState> => ({
                pluginId: manifest.id,
                pluginVersion: manifest.version,
                data: core.preset('Beatality').doc,
            }),
            setState: async (state: PluginState) => {
                if (state.pluginId !== manifest.id) {
                    throw new Error(`state is for ${state.pluginId}, not ${manifest.id}`)
                }
                const doc = decodePack(JSON.stringify(state.data))
                if (!doc) {
                    throw new Error('unsupported Beatality state')
                }
                // The host restored it, so the project is not dirty and the changes are not the user's.
                await sources.duringLoad('internal', () => core.loadDocument(doc))
            },
            mount,
            unmount,
            suspend: () => {},
            resume: () => {},
            dispose: () => {
                unmount()
                if (root) {
                    render(null, root)
                    root = null
                }
                releaseStyles?.()
                releaseStyles = null
                listeners.clear()
                stopParameters()
                core.dispose()
            },
        }
    },
}

export default factory
