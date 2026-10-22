import { render } from 'preact'
import { EngineClient } from '../../../hosts/web/client/EngineClient'
import { SampleBufferPresenter } from '../../../presenters/web/SampleBufferPresenter'
import { WebPresenter } from '../../../presenters/web/WebPresenter'
import { WebViewModel } from '../../../viewmodels/web/WebViewModel'
import { SampleBufferView } from '../../../views/web/SampleBufferView'
import { Widget } from './Widget'
import './widget.css'
import wasmUrl from '../../../build-wasm/beatality.wasm?url'

const model = new WebViewModel()
const client = new EngineClient({
    wasmUrl,
    processorUrl: '/beatality-processor.js',
})
const sampleBuffer = new SampleBufferPresenter(new SampleBufferView(document.createElement('div')))
new WebPresenter(model, client, sampleBuffer)

const app = document.querySelector('#app')
if (!app) {
    throw new Error('missing #app')
}
render(<Widget model={model} />, app)

// The same client the buttons use, so the page can be driven from the console.
window.beatality = client

declare global {
    interface Window {
        beatality: EngineClient
    }
}
