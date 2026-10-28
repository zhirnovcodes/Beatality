import { SampleBufferPresenter } from '../../../presenters/web/SampleBufferPresenter'
import { SampleBufferView } from '../../../views/web/SampleBufferView'
import './sampleBuffer.css'

const bpm = 120
const loopBeats = 4
const sliceBeats = 2
const sampleRate = 48000
const durationSec = (loopBeats * 60) / bpm

const app = document.querySelector('#app')
if (!(app instanceof HTMLElement)) {
    throw new Error('missing #app')
}

const view = new SampleBufferView(app)
const presenter = new SampleBufferPresenter(view)
let playhead = sliceBeats
presenter.show({
    samples: demoSamples(sampleRate, durationSec),
    sampleRate,
    bpm,
    loopBeats,
    sliceBeats,
    start: 0,
    length: 1,
    loop: false,
    volume: 1,
    pan: 0,
    playheadBeats: playhead,
})

// One pass across the loop takes about four seconds, starting on the second slice.
window.setInterval(() => {
    playhead = (playhead + loopBeats / (30 * 4)) % loopBeats
    presenter.setPlayhead(playhead)
}, 1000 / 30)

function demoSamples(sampleRate: number, durationSec: number): Float32Array {
    const count = Math.floor(sampleRate * durationSec)
    const samples = new Float32Array(count)
    for (let i = 0; i < count; i++) {
        const t = i / sampleRate
        samples[i] = Math.sin(2 * Math.PI * 70 * t) * 0.55
    }
    const add = (startSec: number, lengthSec: number, freq: number, gain: number, decay: number) => {
        const start = Math.floor(startSec * sampleRate)
        const length = Math.floor(lengthSec * sampleRate)
        for (let i = 0; i < length && start + i < count; i++) {
            const t = i / sampleRate
            samples[start + i] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * decay) * gain
        }
    }
    add(0.02, 0.7, 90, 0.55, 3)
    add(0.15, 0.5, 240, 0.35, 6)
    add(0.82, 0.28, 180, 0.95, 8)
    add(1.25, 0.45, 70, 0.7, 4)
    add(1.85, 0.12, 400, 0.8, 20)
    return samples
}
