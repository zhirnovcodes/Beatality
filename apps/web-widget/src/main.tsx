import { render } from 'preact'
import { EngineClient } from '../../../hosts/web/client/EngineClient'
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
const bank = document.createElement('div')
bank.className = 'sample-bank'
new WebPresenter(model, client, bank)

const app = document.querySelector('#app')
if (!app) {
    throw new Error('missing #app')
}
render(<Widget model={model} bank={bank} />, app)

const loadPack = document.querySelector('#load-pack')
if (!(loadPack instanceof HTMLButtonElement)) {
    throw new Error('missing #load-pack')
}

loadPack.addEventListener('click', () => {
    const unlocking = client.start()
    void (async () => {
        loadPack.disabled = true
        try {
            await client.stop()
            const files = await Promise.all(demoPack.map(fetchPackFile))
            await unlocking
            const loaded = await client.replace(files)
            if (loaded === 0) {
                model.fail('could not load Demo')
            }
        } catch (error) {
            model.fail(error instanceof Error ? error.message : String(error))
        } finally {
            loadPack.disabled = false
        }
    })()
})

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
