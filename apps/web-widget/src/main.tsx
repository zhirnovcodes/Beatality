import type { PluginEvent } from '../../../hosts/web/plugin'
import { beatality } from './plugin'
import './page.css'

// Stands in for the wrapper: one plugin, a Play button for a held note, and the project's tempo.
// The page owns the context. It starts suspended, and the plugin resumes it on the first click that reaches the engine.
const context = new AudioContext()

const app = document.querySelector('#app')
if (!(app instanceof HTMLElement)) {
    throw new Error('missing #app')
}
const preview = document.querySelector('#preview')
if (!(preview instanceof HTMLButtonElement)) {
    throw new Error('missing #preview')
}
const projectBpm = document.querySelector('#project-bpm')
if (!(projectBpm instanceof HTMLInputElement)) {
    throw new Error('missing #project-bpm')
}

const plugin = await beatality.create(context, app)
plugin.audioOutput?.connect(context.destination)

const tempo = (bpm: number): PluginEvent => ({ type: 'tempo', time: context.currentTime, bpm })

const previewNote = 36
const previewVelocity = 127

let previewHeld = false
const showPreview = () => {
    preview.textContent = previewHeld ? 'Stop' : 'Play'
}
preview.disabled = false
showPreview()

preview.addEventListener('click', () => {
    previewHeld = !previewHeld
    showPreview()
    const bytes: [number, number, number] = previewHeld ? [0x90, previewNote, previewVelocity] : [0x80, previewNote, 0]
    plugin.schedule([{ type: 'midi', time: context.currentTime, bytes }])
})

let bpm = Math.round(projectBpm.valueAsNumber)
plugin.schedule([tempo(bpm)])
projectBpm.addEventListener('change', () => {
    const next = Math.round(projectBpm.valueAsNumber)
    if (next >= 1 && next <= 999) {
        bpm = next
        plugin.schedule([tempo(bpm)])
    }
    projectBpm.value = String(bpm)
})
