import { render } from 'preact'
import type { PackDocument } from '../../../hosts/web/pack'
import { sourceDragType, type PluginEvent, type PluginFactory, type PluginInstance } from '../../../hosts/web/plugin'
import { WebPresenter } from '../../../presenters/web/WebPresenter'
import { createCore } from './beatalityCore'
import { Widget } from './Widget'
import './widget.css'
import wasmUrl from '../../../build-wasm/beatality.wasm?url'

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
        const core = createCore(context, {
            processor: '/beatality-processor.js',
            wasm: wasmUrl,
            pack: (file) => '/packs/' + file,
            sample: (id) => '/packs/samples/' + encodeURIComponent(id),
            banks: '/packs/banks.json',
        })
        const { model, client, parameters } = core
        const drops = new Set<(source: string, parameter: string) => void>()

        const grid = document.createElement('div')
        grid.className = 'sample-grid'
        grid.setAttribute('role', 'listbox')
        grid.setAttribute('aria-label', 'Samples')
        const presenter = new WebPresenter(model, client, grid, core.loadFactory)

        void core.reloadBanks().catch(() => {})

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
            if (event.type === 'transport') {
                model.setProjectBpm(event.state.bpm)
                void client.transport(event.time, event.state)
            } else {
                core.play(event)
            }
        }

        return {
            audioInput: null,
            audioOutput: client.output,
            preset: core.preset,
            reloadBanks: core.reloadBanks,
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
                core.dispose()
            },
        }
    },
} satisfies PluginFactory
