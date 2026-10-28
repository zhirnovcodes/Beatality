import type { EngineClient } from '../../hosts/web/client/EngineClient'
import type { WebViewModel } from '../../viewmodels/web/WebViewModel'
import { SampleBufferPresenter } from './SampleBufferPresenter'
import { SampleBufferView } from '../../views/web/SampleBufferView'

interface SampleRow {
    samples: Float32Array
    presenter: SampleBufferPresenter
    spectrum: HTMLElement
}

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function formatSeconds(seconds: number): string {
    const rounded = Math.round(seconds * 1000) / 1000
    return String(rounded)
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
    private startInput: HTMLInputElement | null = null
    private lengthInput: HTMLInputElement | null = null
    private loopInput: HTMLInputElement | null = null
    private trackControls: HTMLFieldSetElement | null = null
    private volumeInput: HTMLInputElement | null = null
    private panInput: HTMLInputElement | null = null
    private trackStartInput: HTMLInputElement | null = null
    private trackStartSecInput: HTMLInputElement | null = null
    private trackLengthInput: HTMLInputElement | null = null
    private trackLoopInput: HTMLInputElement | null = null
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

    listenSelection(listener: (index: number) => void) {
        this.selectionListener = listener
        listener(this.selected)
    }

    bindPanel(panel: HTMLFieldSetElement) {
        if (this.panelBound) {
            return
        }
        const start = panel.querySelector('#start')
        const length = panel.querySelector('#length')
        const loop = panel.querySelector('#track-loop')
        if (!(start instanceof HTMLInputElement) || !(length instanceof HTMLInputElement) || !(loop instanceof HTMLInputElement)) {
            throw new Error('missing sample panel')
        }
        this.panelBound = true
        this.startInput = start
        this.lengthInput = length
        this.loopInput = loop
        start.addEventListener('input', () => {
            this.rowAt(this.selected)?.presenter.editStart(Number(start.value))
            placeThumb(start)
        })
        length.addEventListener('input', () => {
            this.rowAt(this.selected)?.presenter.editLength(Number(length.value))
            placeThumb(length)
        })
        loop.addEventListener('change', () => {
            this.rowAt(this.selected)?.presenter.editLoop(loop.checked)
        })
        this.syncPanel()
    }

    // Plain controls outside the skin. They edit the selected track.
    bindTrackControls(panel: HTMLFieldSetElement) {
        const volume = panel.querySelector('#track-volume')
        const pan = panel.querySelector('#track-pan')
        const start = panel.querySelector('#track-start')
        const startSec = panel.querySelector('#track-start-sec')
        const length = panel.querySelector('#track-length')
        const loop = panel.querySelector('#track-loop-toggle')
        if (
            !(volume instanceof HTMLInputElement) ||
            !(pan instanceof HTMLInputElement) ||
            !(start instanceof HTMLInputElement) ||
            !(startSec instanceof HTMLInputElement) ||
            !(length instanceof HTMLInputElement) ||
            !(loop instanceof HTMLInputElement)
        ) {
            throw new Error('missing track controls')
        }
        this.trackControls = panel
        this.volumeInput = volume
        this.panInput = pan
        this.trackStartInput = start
        this.trackStartSecInput = startSec
        this.trackLengthInput = length
        this.trackLoopInput = loop
        this.openStart(start, startSec)
        const edit = () => {
            this.rowAt(this.selected)?.presenter.edit({
                volume: Number(volume.value),
                pan: Number(pan.value),
                start: Number(start.value),
                length: Number(length.value),
                loop: loop.checked,
            })
        }
        const editSeconds = (commit: boolean) => {
            const row = this.rowAt(this.selected)
            if (!row) {
                return
            }
            const text = startSec.value.trim()
            const seconds = Number(text)
            const duration = row.presenter.durationSec()
            if (text === '' || !Number.isFinite(seconds)) {
                if (commit) {
                    const current = row.presenter.read()
                    startSec.value = formatSeconds((current?.start ?? 0) * duration)
                }
                return
            }
            const clamped = Math.min(duration, Math.max(0, seconds))
            const fraction = duration > 0 ? clamped / duration : 0
            row.presenter.edit({
                volume: Number(volume.value),
                pan: Number(pan.value),
                start: fraction,
                length: Number(length.value),
                loop: loop.checked,
            })
            if (commit) {
                startSec.value = formatSeconds(clamped)
            }
        }
        volume.addEventListener('input', edit)
        pan.addEventListener('input', edit)
        start.addEventListener('input', edit)
        startSec.addEventListener('input', () => editSeconds(false))
        startSec.addEventListener('change', () => editSeconds(true))
        length.addEventListener('input', edit)
        loop.addEventListener('change', edit)
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

    private syncPanel() {
        const picture = this.selected >= 0 ? this.rowAt(this.selected)?.presenter.read() : null
        if (this.trackControls) {
            this.trackControls.disabled = !picture
        }
        const start = this.startInput
        const length = this.lengthInput
        const loop = this.loopInput
        if (start && length && loop && picture) {
            this.writeRange(start, picture.start)
            this.writeRange(length, picture.length)
            if (document.activeElement !== loop && loop.checked !== picture.loop) {
                loop.checked = picture.loop
            }
        }
        const volume = this.volumeInput
        const pan = this.panInput
        const trackStart = this.trackStartInput
        const trackStartSec = this.trackStartSecInput
        const trackLength = this.trackLengthInput
        const trackLoop = this.trackLoopInput
        if (!picture || !volume || !pan || !trackStart || !trackStartSec || !trackLength || !trackLoop) {
            return
        }
        const durationSec = this.rowAt(this.selected)?.presenter.durationSec() ?? 0
        this.openStart(trackStart, trackStartSec)
        this.writeRange(volume, picture.volume)
        this.writeRange(pan, picture.pan)
        this.writeRange(trackStart, picture.start)
        this.writeSeconds(trackStartSec, picture.start * durationSec, durationSec)
        this.writeRange(trackLength, picture.length)
        if (document.activeElement !== trackLoop && trackLoop.checked !== picture.loop) {
            trackLoop.checked = picture.loop
        }
    }

    private openStart(slider: HTMLInputElement, seconds: HTMLInputElement) {
        slider.readOnly = false
        slider.disabled = false
        seconds.readOnly = false
        seconds.disabled = false
    }

    private writeSeconds(input: HTMLInputElement, value: number, max: number) {
        const limit = max > 0 ? max : 0
        input.max = String(limit)
        input.readOnly = false
        if (document.activeElement === input) {
            return
        }
        const shown = formatSeconds(Math.min(limit, Math.max(0, value)))
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
