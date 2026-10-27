import type { EngineClient } from '../../hosts/web/client/EngineClient'
import type { WebViewModel } from '../../viewmodels/web/WebViewModel'
import { SampleBufferPresenter } from './SampleBufferPresenter'
import { SampleBufferView } from '../../views/web/SampleBufferView'

interface SampleRow {
    samples: Float32Array
    presenter: SampleBufferPresenter
    element: HTMLElement
    strip: HTMLElement
    controls: HTMLElement
}

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

// Turns control actions into client calls, and snapshots into the view model.
export class WebPresenter {
    private playSlot = -1
    private playTrack = -1
    private selected = -1
    private rows: SampleRow[] = []

    constructor(
        private readonly model: WebViewModel,
        private readonly client: EngineClient,
        private readonly buffer: HTMLElement,
        private readonly controls: HTMLFieldSetElement,
        private readonly list: HTMLElement,
        loadPack: () => Promise<void>,
    ) {
        model.bind({
            midi: (status, note, velocity) => void this.perform(() => this.client.midi(status, note, velocity)),
            loadPack: () => this.perform(loadPack),
            append: (files) => void this.perform(() => this.append(files)),
            remove: (index) => void this.perform(() => this.remove(index)),
            clear: () => void this.perform(() => this.clear()),
            randomize: () => void this.perform(() => this.randomize()),
            setBpm: (bpm) => void this.perform(() => this.client.setBpm(bpm)),
            setLoop: (beats) => void this.perform(() => this.client.setLoop(beats)),
            setSlice: (exponent) => void this.perform(() => this.client.setSlice(exponent)),
            setAttack: (ms) => void this.perform(() => this.client.setAttack(ms)),
        })
        client.onSnapshot = (snapshot) => {
            this.playSlot = snapshot.playing ? snapshot.playSlot : -1
            this.playTrack = snapshot.playing ? snapshot.playTrack : -1
            model.show({
                names: snapshot.names,
                playing: snapshot.playing,
                sliceExp: snapshot.sliceExp,
                playhead: snapshot.playhead,
            })
            this.markPlaying()
        }
        client.onError = (message) => model.fail(message)
        model.subscribe(() => this.sync())
        this.sync()
    }

    // The row whose Start, Length, and Loop are on the page. -1 when none.
    chosen(): number {
        return this.selected
    }

    private sync() {
        this.followSample()
        this.markPlaying()
        this.paintList()
        this.mount()
    }

    private followSample() {
        const waves: { samples: Float32Array; sampleRate: number; name: string }[] = []
        for (let index = 0; index < this.model.tracks.length; index++) {
            const wave = this.client.registry.wave(index)
            if (!wave) {
                continue
            }
            waves.push({ samples: wave.samples, sampleRate: wave.sampleRate, name: this.model.tracks[index].name })
        }
        const kept = new Set(waves.map((wave) => wave.samples))
        this.rows = this.rows.filter((row) => {
            if (kept.has(row.samples)) {
                return true
            }
            row.presenter.clear()
            row.strip.remove()
            row.controls.remove()
            row.element.remove()
            return false
        })
        const sliceBeats = 2 ** this.model.sliceExp
        for (const wave of waves) {
            let row = this.rows.find((item) => item.samples === wave.samples)
            if (!row) {
                row = this.createRow(wave.name, wave.samples)
                this.rows.push(row)
            }
            row.presenter.follow({
                samples: wave.samples,
                sampleRate: wave.sampleRate,
                bpm: this.model.bpm,
                loopBeats: this.model.loopBeats,
                sliceBeats,
            })
        }
        if (this.selected >= this.model.tracks.length) {
            this.selected = -1
        }
    }

    private createRow(name: string, samples: Float32Array): SampleRow {
        const host = document.createElement('div')
        const view = new SampleBufferView(host)
        view.setName(name)
        const element = host.querySelector('.sample-buffer')
        const strip = host.querySelector('.sample-buffer-strip')
        const controls = host.querySelector('.sample-buffer-controls')
        if (!(element instanceof HTMLElement) || !(strip instanceof HTMLElement) || !(controls instanceof HTMLElement)) {
            throw new Error('missing sample buffer')
        }
        const presenter = new SampleBufferPresenter(view)
        presenter.onEdit = (start, length, loop) => {
            const index = this.indexOf(samples)
            if (index >= 0) {
                void this.client.setTrack(index, start, length, loop)
            }
        }
        return { samples, presenter, element, strip, controls }
    }

    private indexOf(samples: Float32Array): number {
        for (let index = 0; index < this.model.tracks.length; index++) {
            if (this.client.registry.wave(index)?.samples === samples) {
                return index
            }
        }
        return -1
    }

    private rowAt(index: number): SampleRow | null {
        const wave = this.client.registry.wave(index)
        if (!wave) {
            return null
        }
        return this.rows.find((row) => row.samples === wave.samples) ?? null
    }

    // The strip in the top slot. The selected row, or the first track before a click.
    private headerRow(): number {
        if (this.selected >= 0 && this.selected < this.model.tracks.length) {
            return this.selected
        }
        return this.model.tracks.length > 0 ? 0 : -1
    }

    private paintList() {
        const tracks = this.model.tracks
        let same = this.list.childElementCount === tracks.length
        if (same) {
            const items = this.list.children
            for (let index = 0; index < tracks.length; index++) {
                if (items[index].getAttribute('data-name') !== tracks[index].name) {
                    same = false
                    break
                }
            }
        }
        if (!same) {
            this.list.replaceChildren()
            for (let index = 0; index < tracks.length; index++) {
                const item = document.createElement('li')
                item.setAttribute('role', 'option')
                item.setAttribute('data-name', tracks[index].name)
                const label = document.createElement('div')
                label.className = 'track-name'
                label.textContent = tracks[index].name
                item.append(label)
                item.addEventListener('click', () => {
                    this.selected = index
                    this.paintList()
                    this.mount()
                })
                this.list.append(item)
            }
        }
        const items = this.list.children
        for (let index = 0; index < items.length; index++) {
            const item = items[index]
            item.setAttribute('aria-selected', index === this.selected ? 'true' : 'false')
            if (index === this.playTrack) {
                item.setAttribute('data-heard', '')
            } else {
                item.removeAttribute('data-heard')
            }
        }
    }

    // Every track keeps its picture. The chosen one sits in the top slot; the rest stay on their rows.
    private mount() {
        const shown = this.headerRow()
        const items = this.list.children
        for (let index = 0; index < this.model.tracks.length; index++) {
            const row = this.rowAt(index)
            if (!row || index === shown) {
                continue
            }
            const item = items[index]
            if (!item || row.strip.parentElement === item) {
                continue
            }
            item.append(row.strip)
            row.presenter.refit()
        }
        const shownRow = shown >= 0 ? this.rowAt(shown) : null
        if (shownRow) {
            if (shownRow.strip.parentElement !== this.buffer) {
                this.buffer.replaceChildren(shownRow.strip)
                shownRow.presenter.refit()
            }
        } else if (this.buffer.childElementCount > 0) {
            this.buffer.replaceChildren()
        }
        const selected = this.selected >= 0 ? this.rowAt(this.selected) : null
        if (selected) {
            if (selected.controls.parentElement !== this.controls) {
                this.controls.replaceChildren(selected.controls)
            }
            this.controls.disabled = false
        } else {
            if (this.controls.childElementCount > 0) {
                this.controls.replaceChildren()
            }
            this.controls.disabled = true
        }
    }

    private markPlaying() {
        const sliceBeats = 2 ** this.model.sliceExp
        for (let index = 0; index < this.model.tracks.length; index++) {
            const row = this.rowAt(index)
            if (!row) {
                continue
            }
            const heard = this.playSlot >= 0 && index === this.playTrack
            row.presenter.setPlayhead(heard ? this.playSlot * sliceBeats : -1)
        }
    }

    private async append(files: File[]) {
        await this.client.append(files)
    }

    private async remove(index: number) {
        if (!this.model.hasTracks) {
            return
        }
        await this.client.removeAt(index)
    }

    private async clear() {
        if (!this.model.hasTracks) {
            return
        }
        this.selected = -1
        await this.client.clear()
    }

    private async randomize() {
        if (!this.model.hasTracks) {
            return
        }
        await this.client.randomize()
    }

    private async perform(action: () => Promise<void>) {
        try {
            await action()
        } catch (error) {
            if (isAbort(error)) {
                return
            }
            this.model.fail(error instanceof Error ? error.message : String(error))
        }
    }
}
