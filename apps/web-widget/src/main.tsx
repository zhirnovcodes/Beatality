import { render } from 'preact'
import { EngineClient } from '../../../hosts/web/client/EngineClient'
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
const bank = document.createElement('div')
bank.className = 'sample-bank'
new WebPresenter(model, client, bank)

const app = document.querySelector('#app')
if (!app) {
    throw new Error('missing #app')
}
render(<Widget model={model} bank={bank} />, app)

// The same client the buttons use, so the page can be driven from the console.
window.beatality = client

declare global {
    interface Window {
        beatality: EngineClient
    }
}
