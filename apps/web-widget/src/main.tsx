import { render } from 'preact'
import { EngineClient } from '../../../hosts/web/client/EngineClient'
import { MidiStatus } from '../../../hosts/web/messages'
import { decodeBanks, decodePack } from '../../../hosts/web/pack'
import { WebPresenter } from '../../../presenters/web/WebPresenter'
import { WebViewModel } from '../../../viewmodels/web/WebViewModel'
import { Widget } from './Widget'
import './widget.css'
import wasmUrl from '../../../build-wasm/beatality.wasm?url'

const model = new WebViewModel()
const client = new EngineClient({
    wasmUrl,
    processorUrl: '/beatality-processor.js',
})
const grid = document.createElement('div')
grid.className = 'sample-grid'
grid.id = 'sample-grid'
grid.setAttribute('role', 'listbox')
grid.setAttribute('aria-label', 'Samples')
const presenter = new WebPresenter(model, client, grid, loadFactory)

void fetch('/packs/banks.json')
    .then(async (response) => {
        if (!response.ok) {
            return
        }
        model.setFactoryBanks(decodeBanks(await response.json()))
    })
    .catch(() => {})

const app = document.querySelector('#app')
if (!app) {
    throw new Error('missing #app')
}
render(
    <Widget
        model={model}
        grid={grid}
        bindPanel={(panel) => presenter.bindPanel(panel)}
        listenSelection={(listener) => presenter.listenSelection(listener)}
        chosen={() => presenter.chosen()}
    />,
    app,
)

const previewNote = 36
const previewVelocity = 1

const preview = document.querySelector('#preview')
if (!(preview instanceof HTMLButtonElement)) {
    throw new Error('missing #preview')
}

let previewHeld = false
const showPreview = () => {
    preview.textContent = previewHeld ? 'Stop' : 'Play'
    preview.disabled = !previewHeld && !model.hasTracks
}
model.subscribe(showPreview)
showPreview()

preview.addEventListener('click', () => {
    previewHeld = !previewHeld
    showPreview()
    void client.midi(previewHeld ? MidiStatus.On : MidiStatus.Off, previewNote, previewVelocity)
})

const projectBpm = document.querySelector('#project-bpm')
if (!(projectBpm instanceof HTMLInputElement)) {
    throw new Error('missing #project-bpm')
}
model.setProjectBpm(projectBpm.valueAsNumber)
projectBpm.addEventListener('change', () => {
    const bpm = Math.round(projectBpm.valueAsNumber)
    if (bpm >= 1 && bpm <= 999) {
        model.setProjectBpm(bpm)
    }
    projectBpm.value = String(model.projectBpm)
})

async function loadFactory(file: string): Promise<void> {
    if (previewHeld) {
        previewHeld = false
        showPreview()
        await client.midi(MidiStatus.Off, previewNote, previewVelocity)
    }
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
    // The pack's tempo is the widget's own. While synced the engine keeps the project's.
    await client.loadDocument({ ...doc, bpm: model.engineBpm }, async (id) => {
        const sample = await fetch('/packs/demo/' + encodeURIComponent(id))
        if (!sample.ok) {
            return null
        }
        return new File([await sample.arrayBuffer()], id)
    })
}

// The same client the buttons use, so the page can be driven from the console.
window.beatality = client

declare global {
    interface Window {
        beatality: EngineClient
    }
}
