import type { EngineClient } from '../../hosts/web/client/EngineClient'
import type { WebViewModel } from '../../viewmodels/web/WebViewModel'
import { SampleBufferPresenter, type TrackEdit } from './SampleBufferPresenter'
import { SampleBufferView } from '../../views/web/SampleBufferView'

interface SampleRow {
    samples: Float32Array
    presenter: SampleBufferPresenter
    spectrum: HTMLElement
}

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function placeThumb(input: HTMLInputElement) {
    const slider = input.closest('.slider')
    if (!(slider instanceof HTMLElement)) {
        return
    }
    const min = Number(input.min)
    const max = Number(input.max)
    const value = Number(input.value)
    const pos = max > min ? (value - min) / (max - min) : 0
    slider.style.setProperty('--pos', String(pos))
    const snap = input.dataset.snap
    if (snap != null && snap !== '') {
        const target = Number(snap)
        slider.style.setProperty('--snap', String(max > min ? (target - min) / (max - min) : 0))
    }
}

// Within 4% of the range, the thumb sticks to data-snap (volume 1, pan 0).
function holdSnap(input: HTMLInputElement): number {
    const min = Number(input.min)
    const max = Number(input.max)
    let value = Number(input.value)
    const snap = input.dataset.snap
    if (snap != null && snap !== '') {
        const target = Number(snap)
        if (Number.isFinite(target) && Math.abs(value - target) <= (max - min) * 0.04) {
            value = target
            input.value = String(value)
        }
    }
    placeThumb(input)
    return value
}

// Skin sample row. The grid is 424px wide and each row is 28px tall.
const skinRow = { width: 424, height: 28, offset: 0, chrome: false }

// Turns control actions into client calls, and snapshots into the view model.
export class WebPresenter {
    private playSlot = -1
    private playTrack = -1
    private selected = -1
    private builtColumns = -1
    private rows: SampleRow[] = []
    private panelBound = false
    private volumeInput: HTMLInputElement | null = null
    private panInput: HTMLInputElement | null = null
    private startInput: HTMLInputElement | null = null
    private lengthInput: HTMLInputElement | null = null
    private startTimeInput: HTMLInputElement | null = null
    private loopInput: HTMLInputElement | null = null
    private selectionListener: (index: number) => void = () => {}

    constructor(
        private readonly model: WebViewModel,
        private readonly client: EngineClient,
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
            setOutput: (volume, pan) => void this.perform(() => this.client.setOutput(volume, pan)),
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

    // The row whose sample controls are on the page. -1 when none.
    chosen(): number {
        return this.selected
    }

    listenSelection(listener: (index: number) => void) {
        this.selectionListener = listener
        listener(this.selected)
    }

    bindPanel(panel: HTMLFieldSetElement) {
        if (this.panelBound) {
            return
        }
        const volume = panel.querySelector('#volume')
        const pan = panel.querySelector('#pan')
        const start = panel.querySelector('#start')
        const length = panel.querySelector('#length')
        const startTime = panel.querySelector('#start-time')
        const loop = panel.querySelector('#track-loop')
        if (
            !(volume instanceof HTMLInputElement) ||
            !(pan instanceof HTMLInputElement) ||
            !(start instanceof HTMLInputElement) ||
            !(length instanceof HTMLInputElement) ||
            !(startTime instanceof HTMLInputElement) ||
            !(loop instanceof HTMLInputElement)
        ) {
            throw new Error('missing sample panel')
        }
        this.panelBound = true
        this.volumeInput = volume
        this.panInput = pan
        this.startInput = start
        this.lengthInput = length
        this.startTimeInput = startTime
        this.loopInput = loop
        volume.addEventListener('input', () => {
            this.editSelected({ volume: holdSnap(volume) })
        })
        pan.addEventListener('input', () => {
            this.editSelected({ pan: holdSnap(pan) })
        })
        start.addEventListener('input', () => {
            placeThumb(start)
            this.editSelected({ start: Number(start.value) })
        })
        length.addEventListener('input', () => {
            placeThumb(length)
            this.editSelected({ length: Number(length.value) })
        })
        loop.addEventListener('change', () => {
            this.editSelected({ loop: loop.checked })
        })
        startTime.addEventListener('change', () => this.commitStartTime())
        startTime.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                startTime.blur()
            }
        })
        this.syncPanel()
    }

    private sync() {
        this.followSample()
        this.markPlaying()
        this.paintList()
    }

    private followSample() {
        const waves: { samples: Float32Array; right: Float32Array; sampleRate: number; name: string }[] = []
        for (let index = 0; index < this.model.tracks.length; index++) {
            const wave = this.client.registry.wave(index)
            if (!wave) {
                continue
            }
            waves.push({
                samples: wave.samples,
                right: wave.right,
                sampleRate: wave.sampleRate,
                name: this.model.tracks[index].name,
            })
        }
        const kept = new Set(waves.map((wave) => wave.samples))
        this.rows = this.rows.filter((row) => {
            if (kept.has(row.samples)) {
                return true
            }
            row.presenter.clear()
            row.spectrum.remove()
            return false
        })
        const sliceBeats = 2 ** this.model.sliceExp
        for (const wave of waves) {
            let row = this.rows.find((item) => item.samples === wave.samples)
            if (!row) {
                row = this.createRow(wave.samples)
                this.rows.push(row)
            }
            row.presenter.follow({
                samples: wave.samples,
                right: wave.right,
                sampleRate: wave.sampleRate,
                bpm: this.model.bpm,
                loopBeats: this.model.loopBeats,
                sliceBeats,
            })
        }
        if (this.selected >= this.model.tracks.length) {
            this.selected = -1
            this.selectionListener(-1)
        }
    }

    private createRow(samples: Float32Array): SampleRow {
        const spectrum = document.createElement('div')
        spectrum.className = 'spectrum'
        const view = new SampleBufferView(spectrum, skinRow)
        const presenter = new SampleBufferPresenter(view)
        presenter.onEdit = (play) => {
            const index = this.indexOf(samples)
            if (index < 0) {
                return
            }
            void this.client.setTrack(index, play.start, play.length, play.loop, play.volume, play.pan)
            if (index === this.selected) {
                this.syncPanel()
            }
        }
        return { samples, presenter, spectrum }
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

    private columns(): number {
        const sliceBeats = 2 ** this.model.sliceExp
        return Math.max(1, Math.round(this.model.loopBeats / sliceBeats))
    }

    private namesMatch(): boolean {
        const tracks = this.model.tracks
        if (this.list.childElementCount !== tracks.length) {
            return false
        }
        const items = this.list.children
        for (let index = 0; index < tracks.length; index++) {
            if (items[index].getAttribute('data-name') !== tracks[index].name) {
                return false
            }
        }
        return true
    }

    private paintList() {
        const cols = this.columns()
        if (!this.namesMatch()) {
            this.rebuildRows(cols)
        } else if (this.builtColumns !== cols) {
            this.retile(cols)
            this.builtColumns = cols
        }
        this.markCells(cols)
        this.syncPanel()
    }

    private rebuildRows(cols: number) {
        const tracks = this.model.tracks
        const rows: HTMLElement[] = []
        for (let index = 0; index < tracks.length; index++) {
            const row = document.createElement('div')
            row.className = 'row'
            row.setAttribute('role', 'option')
            row.setAttribute('data-name', tracks[index].name)
            row.title = tracks[index].name
            const data = this.rowAt(index)
            if (data) {
                row.append(data.spectrum)
                data.presenter.refit()
            }
            for (let column = 0; column < cols; column++) {
                const cell = document.createElement('div')
                cell.className = 'cell'
                row.append(cell)
            }
            row.addEventListener('click', () => this.choose(index))
            rows.push(row)
        }
        this.list.replaceChildren(...rows)
        this.builtColumns = cols
    }

    private retile(cols: number) {
        const items = this.list.children
        for (let index = 0; index < items.length; index++) {
            const row = items[index]
            row.querySelectorAll('.cell').forEach((cell) => cell.remove())
            for (let column = 0; column < cols; column++) {
                const cell = document.createElement('div')
                cell.className = 'cell'
                row.append(cell)
            }
        }
    }

    private choose(index: number) {
        this.selected = index
        this.markCells(this.columns())
        this.syncPanel()
        this.selectionListener(index)
    }

    private markCells(cols: number) {
        const items = this.list.children
        for (let index = 0; index < items.length; index++) {
            const row = items[index]
            row.setAttribute('aria-selected', index === this.selected ? 'true' : 'false')
            const playingCol = index === this.playTrack && this.playSlot >= 0 && this.playSlot < cols ? this.playSlot : -1
            const cells = row.querySelectorAll('.cell')
            for (let column = 0; column < cells.length; column++) {
                cells[column].classList.toggle('playing', column === playingCol)
            }
        }
    }

    private editSelected(patch: Partial<TrackEdit>) {
        const row = this.rowAt(this.selected)
        const current = row?.presenter.read()
        if (!row || !current) {
            return
        }
        row.presenter.edit({ ...current, ...patch })
    }

    private commitStartTime() {
        const field = this.startTimeInput
        const row = this.rowAt(this.selected)
        if (!field || !row) {
            return
        }
        const duration = row.presenter.durationSec()
        const parsed = Number.parseFloat(field.value.trim().replace(',', '.'))
        const seconds = Number.isFinite(parsed) ? parsed : 0
        const clamped = Math.min(duration, Math.max(0, seconds))
        const fraction = duration > 0 ? clamped / duration : 0
        field.value = clamped.toFixed(2)
        this.editSelected({ start: fraction })
    }

    private syncPanel() {
        const picture = this.selected >= 0 ? this.rowAt(this.selected)?.presenter.read() : null
        const duration = picture ? (this.rowAt(this.selected)?.presenter.durationSec() ?? 0) : 0
        const volume = this.volumeInput
        const pan = this.panInput
        const start = this.startInput
        const length = this.lengthInput
        const startTime = this.startTimeInput
        const loop = this.loopInput
        if (startTime) {
            const limit = duration > 0 ? duration : 0
            startTime.dataset.max = String(limit)
            startTime.max = String(limit)
        }
        if (!volume || !pan || !start || !length || !startTime || !loop) {
            return
        }
        if (!picture) {
            this.writeRange(volume, 1)
            this.writeRange(pan, 0)
            this.writeRange(start, 0)
            this.writeRange(length, 1)
            this.writeStartTime(startTime, 0)
            if (document.activeElement !== loop) {
                loop.checked = false
            }
            return
        }
        this.writeRange(volume, picture.volume)
        this.writeRange(pan, picture.pan)
        this.writeRange(start, picture.start)
        this.writeRange(length, picture.length)
        this.writeStartTime(startTime, picture.start * duration)
        if (document.activeElement !== loop && loop.checked !== picture.loop) {
            loop.checked = picture.loop
        }
    }

    private writeStartTime(input: HTMLInputElement, seconds: number) {
        if (document.activeElement === input) {
            return
        }
        const limit = Number(input.dataset.max)
        const capped = Number.isFinite(limit) ? Math.min(limit, Math.max(0, seconds)) : Math.max(0, seconds)
        const shown = capped.toFixed(2)
        if (input.value !== shown) {
            input.value = shown
        }
    }

    private writeRange(input: HTMLInputElement, value: number) {
        if (document.activeElement === input) {
            return
        }
        if (Math.abs(Number(input.value) - value) > 0.0005) {
            input.value = String(value)
        }
        placeThumb(input)
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
        this.selectionListener(-1)
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
