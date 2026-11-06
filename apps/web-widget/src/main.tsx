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

// Localhost only: save the current state into the preset library, or delete a preset from it.
// The Vite dev server owns the /__presets routes. A build has neither the routes nor this row.
if (import.meta.env.DEV) {
    const row = document.createElement('div')
    row.className = 'page-presets'
    row.innerHTML = `
        <input class="preset-name" type="text" placeholder="Preset name" aria-label="Preset name" />
        <button type="button" class="preset-save">Save preset</button>
        <select class="preset-list" aria-label="Presets"></select>
        <button type="button" class="preset-delete">Delete</button>
        <span class="preset-status" role="status"></span>`
    app.before(row)
    const nameInput = row.querySelector('.preset-name') as HTMLInputElement
    const saveButton = row.querySelector('.preset-save') as HTMLButtonElement
    const list = row.querySelector('.preset-list') as HTMLSelectElement
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
        deleteButton.disabled = banks.length === 0
        await plugin.reloadBanks()
    }

    const busy = (on: boolean, text: string) => {
        saveButton.disabled = on
        deleteButton.disabled = on || banks.length === 0
        status.textContent = text
    }

    const post = async (url: string, body: BodyInit): Promise<any> => {
        const response = await fetch(url, { method: 'POST', body })
        const result = await response.json()
        if (!response.ok) {
            throw new Error(result.error ?? response.statusText)
        }
        return result
    }

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
            const { doc, files } = plugin.preset(name)
            const tracks = []
            for (let i = 0; i < doc.tracks.length; i++) {
                const file = files[i]
                // A missing sample has nothing to store.
                if (!file) {
                    continue
                }
                const { id } = await post('/__presets/sample?name=' + encodeURIComponent(file.name), file)
                tracks.push({ ...doc.tracks[i], source: { type: 'internal' as const, id } })
            }
            const skipped = doc.tracks.length - tracks.length
            await post('/__presets/pack?name=' + encodeURIComponent(name), JSON.stringify({ ...doc, tracks }))
            await refresh()
            busy(false, `Saved "${name}"` + (skipped > 0 ? `, ${skipped} missing sample(s) left out.` : '.'))
        } catch (error) {
            busy(false, 'Save failed: ' + String(error))
        }
    })

    deleteButton.addEventListener('click', async () => {
        const bank = banks.find((item) => item.file === list.value)
        if (!bank || !confirm(`Delete preset "${bank.name}"? Its samples are removed too, unless another preset uses them.`)) {
            return
        }
        busy(true, 'Deleting…')
        try {
            const response = await fetch('/__presets/pack?file=' + encodeURIComponent(bank.file), { method: 'DELETE' })
            if (!response.ok) {
                throw new Error((await response.json()).error ?? response.statusText)
            }
            await refresh()
            busy(false, `Deleted "${bank.name}".`)
        } catch (error) {
            busy(false, 'Delete failed: ' + String(error))
        }
    })

    void refresh().catch(() => {
        status.textContent = 'Could not read the preset list.'
    })
}
