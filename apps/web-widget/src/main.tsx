import type { PluginEvent, TransportState } from '../../../hosts/web/plugin'
import { beatality } from './plugin'
import './page.css'

// Stands in for the wrapper: one plugin, a Play button for the transport and a held note, and the project's tempo.
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
// The page's transport. Play starts it at 0; started is its context time.
let transport: TransportState = { playing: false, bpm: 120, beat: 0, seconds: 0 }
let started = 0
const showPreview = () => {
    preview.textContent = previewHeld ? 'Stop' : 'Play'
}
preview.disabled = false
showPreview()

preview.addEventListener('click', () => {
    previewHeld = !previewHeld
    showPreview()
    const time = context.currentTime
    if (previewHeld) {
        started = time
        transport = { playing: true, bpm, beat: 0, seconds: 0 }
        plugin.schedule([
            { type: 'transport', time, state: transport },
            { type: 'midi', time, bytes: [0x90, previewNote, previewVelocity] },
        ])
    } else {
        transport = { playing: false, bpm, beat: 0, seconds: 0 }
        plugin.schedule([
            { type: 'midi', time, bytes: [0x80, previewNote, 0] },
            { type: 'transport', time, state: transport },
        ])
    }
})

let bpm = Math.round(projectBpm.valueAsNumber)
plugin.schedule([tempo(bpm)])
projectBpm.addEventListener('change', () => {
    const next = Math.round(projectBpm.valueAsNumber)
    if (next >= 1 && next <= 999) {
        // While playing, the transport carries the new tempo from where it is now.
        if (transport.playing) {
            const time = context.currentTime
            const since = time - started
            transport = { playing: true, bpm: next, beat: transport.beat + (since * transport.bpm) / 60, seconds: transport.seconds + since }
            started = time
            plugin.schedule([{ type: 'transport', time, state: transport }])
        }
        bpm = next
        plugin.schedule([tempo(bpm)])
    }
    projectBpm.value = String(bpm)
})

// Localhost only: save the current state into the preset library, update a preset with it, or delete a preset.
// The Vite dev server owns the /__presets routes. A build has neither the routes nor this row.
if (import.meta.env.DEV) {
    const row = document.createElement('div')
    row.className = 'page-presets'
    row.innerHTML = `
        <input class="preset-name" type="text" placeholder="Preset name" aria-label="Preset name" />
        <button type="button" class="preset-save">Save preset</button>
        <select class="preset-list" aria-label="Presets"></select>
        <button type="button" class="preset-update">Update</button>
        <button type="button" class="preset-delete">Delete</button>
        <span class="preset-status" role="status"></span>`
    app.before(row)
    const nameInput = row.querySelector('.preset-name') as HTMLInputElement
    const saveButton = row.querySelector('.preset-save') as HTMLButtonElement
    const list = row.querySelector('.preset-list') as HTMLSelectElement
    const updateButton = row.querySelector('.preset-update') as HTMLButtonElement
    const deleteButton = row.querySelector('.preset-delete') as HTMLButtonElement
    const status = row.querySelector('.preset-status') as HTMLSpanElement
    let banks: { name: string; file: string }[] = []

    const refresh = async () => {
        const response = await fetch('/packs/banks.json', { cache: 'no-store' })
        banks = response.ok ? await response.json() : []
        list.replaceChildren(
            ...banks.map((bank) => {
                const option = document.createElement('option')
                option.value = bank.file
                option.textContent = bank.name
                return option
            }),
        )
        updateButton.disabled = banks.length === 0
        deleteButton.disabled = banks.length === 0
        await plugin.reloadBanks()
    }

    const busy = (on: boolean, text: string) => {
        saveButton.disabled = on
        updateButton.disabled = on || banks.length === 0
        deleteButton.disabled = on || banks.length === 0
        status.textContent = text
    }

    const send = async (method: string, url: string, body?: BodyInit): Promise<any> => {
        const response = await fetch(url, { method, body })
        const result = await response.json()
        if (!response.ok) {
            throw new Error(result.error ?? response.statusText)
        }
        return result
    }

    // Stores each track's sample in the library and returns the pack text that points at them.
    // A missing sample has nothing to store and is left out.
    const upload = async (name: string): Promise<{ text: string; skipped: number }> => {
        const { doc, files } = plugin.preset(name)
        const tracks = []
        for (let i = 0; i < doc.tracks.length; i++) {
            const file = files[i]
            if (!file) {
                continue
            }
            const { id } = await send('POST', '/__presets/sample?name=' + encodeURIComponent(file.name), file)
            tracks.push({ ...doc.tracks[i], source: { type: 'internal' as const, id } })
        }
        return { text: JSON.stringify({ ...doc, tracks }), skipped: doc.tracks.length - tracks.length }
    }

    const leftOut = (skipped: number) => (skipped > 0 ? `, ${skipped} missing sample(s) left out` : '')
    const removed = (ids: string[]) => (ids.length > 0 ? `, ${ids.length} unused sample(s) removed` : '')

    saveButton.addEventListener('click', async () => {
        const name = nameInput.value.trim()
        if (!name) {
            status.textContent = 'Type a preset name first.'
            nameInput.focus()
            return
        }
        if (banks.some((bank) => bank.name.toLowerCase() === name.toLowerCase()) && !confirm(`Overwrite preset "${name}"?`)) {
            return
        }
        busy(true, 'Saving…')
        try {
            const { text, skipped } = await upload(name)
            await send('POST', '/__presets/pack?name=' + encodeURIComponent(name), text)
            await refresh()
            busy(false, `Saved "${name}"${leftOut(skipped)}.`)
        } catch (error) {
            busy(false, 'Save failed: ' + String(error))
        }
    })

    // The chosen preset takes the current state. Its samples follow the track list: new ones are stored,
    // and the ones it no longer uses are removed unless another preset uses them.
    updateButton.addEventListener('click', async () => {
        const bank = banks.find((item) => item.file === list.value)
        if (!bank || !confirm(`Update preset "${bank.name}" with the current settings and tracks?`)) {
            return
        }
        busy(true, 'Updating…')
        try {
            const { text, skipped } = await upload(bank.name)
            const result = await send('PUT', '/__presets/pack?file=' + encodeURIComponent(bank.file), text)
            await refresh()
            list.value = bank.file
            busy(false, `Updated "${bank.name}"${leftOut(skipped)}${removed(result.removedSamples ?? [])}.`)
        } catch (error) {
            busy(false, 'Update failed: ' + String(error))
        }
    })

    deleteButton.addEventListener('click', async () => {
        const bank = banks.find((item) => item.file === list.value)
        if (!bank || !confirm(`Delete preset "${bank.name}"? Its samples are removed too, unless another preset uses them.`)) {
            return
        }
        busy(true, 'Deleting…')
        try {
            const result = await send('DELETE', '/__presets/pack?file=' + encodeURIComponent(bank.file))
            await refresh()
            busy(false, `Deleted "${bank.name}"${removed(result.removedSamples ?? [])}.`)
        } catch (error) {
            busy(false, 'Delete failed: ' + String(error))
        }
    })

    void refresh().catch(() => {
        status.textContent = 'Could not read the preset list.'
    })
}
