import { render } from 'preact'
import { EngineClient } from '../../../hosts/web/client/EngineClient'
import { MidiStatus } from '../../../hosts/web/messages'
import { WebPresenter } from '../../../presenters/web/WebPresenter'
import { WebViewModel } from '../../../viewmodels/web/WebViewModel'
import { Widget } from './Widget'
import './widget.css'
import wasmUrl from '../../../build-wasm/beatality.wasm?url'

const demoPack = [
    '/packs/demo/178381__snapper4298__115bpm-boom-zap-breakbeat.wav',
    '/packs/demo/685110__snapper4298__115bpm_let-the-bass-kick-loop_808.wav',
    '/packs/demo/797799__snapper4298__break-beat-115-bpm.wav',
]

const model = new WebViewModel()
const client = new EngineClient({
    wasmUrl,
    processorUrl: '/beatality-processor.js',
})
const buffer = document.createElement('div')
buffer.style.width = '100%'
buffer.style.height = '100%'
buffer.style.overflow = 'hidden'
const controls = document.createElement('fieldset')
controls.disabled = true
const list = document.createElement('ul')
const presenter = new WebPresenter(model, client, buffer, controls, list, loadDemo)

const app = document.querySelector('#app')
if (!app) {
    throw new Error('missing #app')
}
render(<Widget model={model} buffer={buffer} controls={controls} list={list} chosen={() => presenter.chosen()} />, app)

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

async function loadDemo(): Promise<void> {
    const unlocking = client.start()
    const files = await Promise.all(demoPack.map(fetchPackFile))
    await unlocking
    const loaded = await client.replace(files)
    if (loaded === 0) {
        model.fail('could not load Demo')
    }
}

async function fetchPackFile(url: string): Promise<File> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`could not load ${url}`)
    }
    const slash = url.lastIndexOf('/')
    const name = slash >= 0 ? url.slice(slash + 1) : url
    return new File([await response.arrayBuffer()], name)
}

// The same client the buttons use, so the page can be driven from the console.
window.beatality = client

declare global {
    interface Window {
        beatality: EngineClient
    }
}
