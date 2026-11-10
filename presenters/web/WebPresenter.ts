import type { EngineClient } from '../../hosts/web/client/EngineClient'
import { sampleBpm, warpModes, type SampleSettings } from '../../hosts/web/pack'
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

// The BEAT slider's steps, in beats. Its index over the last index is the engine's warp param.
const beatSteps = ['1/32', '1/16', '1/8', '1/4', '1/2', '1', '2']
// In grain mode the same slider is continuous: its value over grainSteps is the engine's warp param.
const grainSteps = 100
// The engine's grain size for a warp param: 10 ms at 0, 200 ms at 1, on an exponential curve.
const grainMs = (param: number) => 10 * Math.pow(20, param)

// The sample BPM field accepts this range, one decimal place.
const bpmMin = 20
const bpmMax = 999

// Skin sample row. The grid is 424px wide and each row is 28px tall.
const skinRow = { width: 424, height: 28, offset: 0, chrome: false }

// Turns control actions into client calls, and snapshots into the view model.
export class WebPresenter {
    private playSlot = -1
    private playTrack = -1
    // Rows whose sample controls are on the page. The first is the one WARP steps from.
    private selected: readonly number[] = []
    private builtColumns = -1
    private rows: SampleRow[] = []
    private panelBound = false
    private volumeInput: HTMLInputElement | null = null
    private panInput: HTMLInputElement | null = null
    private startInput: HTMLInputElement | null = null
    private lengthInput: HTMLInputElement | null = null
    private startTimeInput: HTMLInputElement | null = null
    private loopInput: HTMLInputElement | null = null
    private bpmInput: HTMLInputElement | null = null
    private warpOutput: HTMLOutputElement | null = null
    private beatInput: HTMLInputElement | null = null
    private beatCaption: HTMLElement | null = null
    private selectionListener: (selected: readonly number[]) => void = () => {}

    constructor(
        private readonly model: WebViewModel,
        private readonly client: EngineClient,
        private readonly list: HTMLElement,
        loadPack: (file: string) => Promise<void>,
    ) {
        model.bind({
            midi: (status, note, velocity) => void this.perform(() => this.client.midi(status, note, velocity)),
            loadPack: (file) => this.perform(() => loadPack(file)),
            append: (files) => void this.perform(() => this.append(files)),
            remove: (index) => void this.perform(() => this.remove(index)),
            clear: () => void this.perform(() => this.clear()),
            split: (indices) => void this.perform(() => this.client.splitTracks(indices).then(() => {})),
            selectAll: () => this.selectAll(),
            randomize: () => void this.perform(() => this.randomize()),
            chaos: () => void this.perform(() => this.client.fireChaos()),
            setBpm: (bpm) => void this.perform(() => this.client.setBpm(bpm)),
            setBpmSync: (on) => void this.perform(() => this.client.setBpmSync(on)),
            setLoop: (beats) => void this.perform(() => this.client.setLoop(beats)),
            setSlice: (exponent) => void this.perform(() => this.client.setSlice(exponent)),
            setAttack: (ms) => void this.perform(() => this.client.setAttack(ms)),
            setGlobalPower: (power) => void this.perform(() => this.client.setGlobalPower(power)),
            setEffectsEnabled: (on) => void this.perform(() => this.client.setEffectsEnabled(on)),
            setRetrig: (on) => void this.perform(() => this.client.setRetrig(on)),
            setGlobalBeatRange: (min, max) => void this.perform(() => this.client.setGlobalBeatRange(min, max)),
            setGlobalChance: (chance) => void this.perform(() => this.client.setGlobalChance(chance)),
            setReverbPower: (power) => void this.perform(() => this.client.setReverbPower(power)),
            setReverbChance: (chance) => void this.perform(() => this.client.setReverbChance(chance)),
            setDelayPower: (power) => void this.perform(() => this.client.setDelayPower(power)),
            setDelayChance: (chance) => void this.perform(() => this.client.setDelayChance(chance)),
            setReversePower: (power) => void this.perform(() => this.client.setReversePower(power)),
            setReverseChance: (chance) => void this.perform(() => this.client.setReverseChance(chance)),
            setFilterPower: (power) => void this.perform(() => this.client.setFilterPower(power)),
            setFilterChance: (chance) => void this.perform(() => this.client.setFilterChance(chance)),
            setFlangerPower: (power) => void this.perform(() => this.client.setFlangerPower(power)),
            setFlangerChance: (chance) => void this.perform(() => this.client.setFlangerChance(chance)),
            setTrancePower: (power) => void this.perform(() => this.client.setTrancePower(power)),
            setTranceChance: (chance) => void this.perform(() => this.client.setTranceChance(chance)),
            setShiftPower: (power) => void this.perform(() => this.client.setShiftPower(power)),
            setShiftChance: (chance) => void this.perform(() => this.client.setShiftChance(chance)),
            setRepeatEnabled: (on) => void this.perform(() => this.client.setRepeatEnabled(on)),
            setRepeatSizeRange: (min, max) => void this.perform(() => this.client.setRepeatSizeRange(min, max)),
            setRepeatLength: (exponent) => void this.perform(() => this.client.setRepeatLength(exponent)),
            setRepeatChance: (chance) => void this.perform(() => this.client.setRepeatChance(chance)),
            setRepeatPosition: (index, on) => void this.perform(() => this.client.setRepeatPosition(index, on)),
            setRepeatMix: (mix) => void this.perform(() => this.client.setRepeatMix(mix)),
            setOutput: (volume, panMin, panMax) => void this.perform(() => this.client.setOutput(volume, panMin, panMax)),
            setChaos: (chaos) => void this.perform(() => this.client.setChaos(chaos)),
        })
        client.onControls = (controls) => model.adoptControls(controls)
        client.onSnapshot = (snapshot) => {
            this.playSlot = snapshot.playing ? snapshot.playSlot : -1
            this.playTrack = snapshot.playing ? snapshot.playTrack : -1
            model.show({
                names: snapshot.names,
                missing: snapshot.missing,
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

    // The rows whose sample controls are on the page. Empty when none.
    chosen(): readonly number[] {
        return this.selected
    }

    listenSelection(listener: (selected: readonly number[]) => void) {
        this.selectionListener = listener
        listener(this.selected)
    }

    bindPanel(panel: HTMLFieldSetElement) {
        if (this.panelBound) {
            return
        }
        const volume = panel.querySelector('.slider.vol input')
        const pan = panel.querySelector('.slider.pan input')
        const start = panel.querySelector('.slider.start input')
        const length = panel.querySelector('.slider.length input')
        const startTime = panel.querySelector('.field.time')
        const loop = panel.querySelector('.toggle')
        const bpm = panel.querySelector('.field.bpm')
        const warpPrev = panel.querySelector('.warp-btn.prev')
        const warpNext = panel.querySelector('.warp-btn.next')
        const warp = panel.querySelector('.warp-value')
        const beat = panel.querySelector('.slider.beat input')
        const beatCaption = panel.querySelector('.name.beat .value')
        if (
            !(volume instanceof HTMLInputElement) ||
            !(pan instanceof HTMLInputElement) ||
            !(start instanceof HTMLInputElement) ||
            !(length instanceof HTMLInputElement) ||
            !(startTime instanceof HTMLInputElement) ||
            !(loop instanceof HTMLInputElement) ||
            !(bpm instanceof HTMLInputElement) ||
            !(warpPrev instanceof HTMLButtonElement) ||
            !(warpNext instanceof HTMLButtonElement) ||
            !(warp instanceof HTMLOutputElement) ||
            !(beat instanceof HTMLInputElement) ||
            !(beatCaption instanceof HTMLElement)
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
        this.bpmInput = bpm
        this.warpOutput = warp
        this.beatInput = beat
        this.beatCaption = beatCaption
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
        // BPM, WARP, and BEAT go to the engine only. The waveform keeps showing the file at its own BPM.
        bpm.addEventListener('change', () => {
            const parsed = Number.parseFloat(bpm.value.trim().replace(',', '.'))
            const current = this.shared((index) => this.client.registry.playAt(index)?.bpm)
            const value = Number.isFinite(parsed) ? Math.min(bpmMax, Math.max(bpmMin, sampleBpm(parsed))) : current
            bpm.value = value === undefined ? '--' : value.toFixed(1)
            if (value !== undefined) {
                this.editWarp({ bpm: value })
            }
        })
        bpm.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                bpm.blur()
            }
        })
        warpPrev.addEventListener('click', () => this.stepWarp(-1))
        warpNext.addEventListener('click', () => this.stepWarp(1))
        // The slider's value over its max is the engine param: an index into beatSteps, or a grain size step.
        beat.addEventListener('input', () => {
            placeThumb(beat)
            this.editWarp({ warpParam: Number(beat.value) / Number(beat.max) })
            this.syncWarp()
        })
        this.syncPanel()
    }

    // Steps WARP through none → beat → pitch → grain, wrapping, from the first selected sample's mode.
    // Every selected sample takes the new mode.
    private stepWarp(delta: 1 | -1) {
        const current = this.selected.length > 0 ? this.client.registry.playAt(this.selected[0]) : null
        if (!current) {
            return
        }
        const at = warpModes.indexOf(current.warp)
        this.editWarp({ warp: warpModes[(at + delta + warpModes.length) % warpModes.length] })
        this.syncWarp()
    }

    private editWarp(patch: Partial<SampleSettings>) {
        for (const index of this.selected) {
            const current = this.client.registry.playAt(index)
            if (!current) {
                continue
            }
            const play = { ...current, ...patch }
            this.client.registry.setPlay(index, play)
            void this.client.setTrack(index, play)
        }
        // A new sample BPM moves the slice lines in the file, so the strip is redrawn at it.
        if (patch.bpm !== undefined) {
            this.followSample()
        }
    }

    private sync() {
        this.followSample()
        this.markPlaying()
        this.paintList()
    }

    private followSample() {
        const waves: { samples: Float32Array; right: Float32Array; sampleRate: number; index: number }[] = []
        for (let index = 0; index < this.model.tracks.length; index++) {
            const wave = this.client.registry.wave(index)
            if (!wave) {
                continue
            }
            waves.push({
                samples: wave.samples,
                right: wave.right,
                sampleRate: wave.sampleRate,
                index,
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
            const play = this.client.registry.playAt(wave.index)
            // The file is drawn at its own BPM, where every warp mode measures its slices.
            // The project BPM does not move it.
            row.presenter.follow(
                {
                    samples: wave.samples,
                    right: wave.right,
                    sampleRate: wave.sampleRate,
                    bpm: play?.bpm ?? this.model.bpm,
                    loopBeats: this.model.loopBeats,
                    sliceBeats,
                },
                play ?? undefined,
            )
        }
        const present = this.selected.filter((index) => index < this.model.tracks.length)
        if (present.length !== this.selected.length) {
            this.selected = present
            this.selectionListener(present)
        }
    }

    private createRow(samples: Float32Array): SampleRow {
        const spectrum = document.createElement('div')
        spectrum.className = 'spectrum'
        const view = new SampleBufferView(spectrum, skinRow)
        const presenter = new SampleBufferPresenter(view)
        presenter.onEdit = (edit) => {
            const index = this.indexOf(samples)
            const current = this.client.registry.playAt(index)
            if (index < 0 || !current) {
                return
            }
            // The strip edits start, length, loop, volume, and pan. The warp fields stay as they were.
            const play = { ...current, ...edit }
            this.client.registry.setPlay(index, play)
            void this.client.setTrack(index, play)
            if (this.selected.includes(index)) {
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
            const item = items[index]
            if (item.getAttribute('data-name') !== tracks[index].name) {
                return false
            }
            if ((item.getAttribute('data-missing') === '1') !== tracks[index].missing) {
                return false
            }
            // A reload of the same names brings new audio. Its strip is not in the row yet.
            const data = this.rowAt(index)
            if (data && data.spectrum.parentElement !== item) {
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
            row.setAttribute('data-missing', tracks[index].missing ? '1' : '0')
            row.title = tracks[index].name
            const data = this.rowAt(index)
            if (data) {
                data.spectrum.querySelector('.missing-label')?.remove()
                row.append(data.spectrum)
                data.presenter.refit()
                if (tracks[index].missing) {
                    const label = document.createElement('div')
                    label.className = 'missing-label'
                    label.textContent = 'error loading track'
                    data.spectrum.append(label)
                }
            }
            for (let column = 0; column < cols; column++) {
                const cell = document.createElement('div')
                cell.className = 'cell'
                row.append(cell)
            }
            // Dragging the row grabs the wave. Left brings later audio in, so start goes up.
            // A selected row drags every selected row's wave by the same pixels.
            let downX = 0
            let downStarts = new Map<number, number>()
            let dragging = false
            // Shift toggles the row in and out of the selection. A drag does not select.
            row.addEventListener('click', (event) => {
                if (!dragging) {
                    this.choose(index, event.shiftKey)
                }
            })
            row.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return
                }
                const moved = this.selected.includes(index) ? this.selected : [index]
                downStarts = new Map()
                for (const at of moved) {
                    const start = this.rowAt(at)?.presenter.read()?.start
                    if (start !== undefined) {
                        downStarts.set(at, start)
                    }
                }
                dragging = false
                if (!downStarts.has(index)) {
                    return
                }
                row.setPointerCapture(event.pointerId)
                downX = event.clientX
            })
            row.addEventListener('pointermove', (event) => {
                if (!row.hasPointerCapture(event.pointerId)) {
                    return
                }
                const dx = event.clientX - downX
                if (!dragging && Math.abs(dx) < 3) {
                    return
                }
                dragging = true
                for (const [at, start] of downStarts) {
                    const presenter = this.rowAt(at)?.presenter
                    if (presenter) {
                        presenter.editStart(start - dx * presenter.startPerPixel())
                    }
                }
            })
            const release = (event: PointerEvent) => {
                if (row.hasPointerCapture(event.pointerId)) {
                    row.releasePointerCapture(event.pointerId)
                }
            }
            row.addEventListener('pointerup', release)
            row.addEventListener('pointercancel', release)
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

    private choose(index: number, toggle: boolean) {
        if (!toggle) {
            this.selected = [index]
        } else if (this.selected.includes(index)) {
            this.selected = this.selected.filter((at) => at !== index)
        } else {
            this.selected = [...this.selected, index]
        }
        this.markCells(this.columns())
        this.syncPanel()
        this.selectionListener(this.selected)
    }

    private selectAll() {
        this.selected = this.model.tracks.map((_, index) => index)
        this.markCells(this.columns())
        this.syncPanel()
        this.selectionListener(this.selected)
    }

    // The value every selected row has, or undefined when they differ or none is selected.
    private shared<T>(read: (index: number) => T | undefined): T | undefined {
        let value: T | undefined
        for (let at = 0; at < this.selected.length; at++) {
            const next = read(this.selected[at])
            if (next === undefined || (at > 0 && next !== value)) {
                return undefined
            }
            value = next
        }
        return value
    }

    private markCells(cols: number) {
        const items = this.list.children
        for (let index = 0; index < items.length; index++) {
            const row = items[index]
            row.setAttribute('aria-selected', this.selected.includes(index) ? 'true' : 'false')
            const playingCol = index === this.playTrack && this.playSlot >= 0 && this.playSlot < cols ? this.playSlot : -1
            const cells = row.querySelectorAll('.cell')
            for (let column = 0; column < cells.length; column++) {
                cells[column].classList.toggle('playing', column === playingCol)
            }
        }
    }

    private editSelected(patch: Partial<TrackEdit>) {
        for (const index of this.selected) {
            const row = this.rowAt(index)
            const current = row?.presenter.read()
            if (!row || !current) {
                continue
            }
            row.presenter.edit({ ...current, ...patch })
        }
    }

    // The typed seconds go to every selected row, each held inside its own file.
    private commitStartTime() {
        const field = this.startTimeInput
        if (!field) {
            return
        }
        const parsed = Number.parseFloat(field.value.trim().replace(',', '.'))
        const seconds = Number.isFinite(parsed) ? parsed : 0
        for (const index of this.selected) {
            const row = this.rowAt(index)
            const current = row?.presenter.read()
            if (!row || !current) {
                continue
            }
            const duration = row.presenter.durationSec()
            const clamped = Math.min(duration, Math.max(0, seconds))
            row.presenter.edit({ ...current, start: duration > 0 ? clamped / duration : 0 })
        }
        const shown = this.shared((index) => this.startSeconds(index))
        field.value = shown ?? '--'
    }

    // Start of the row in seconds as the field shows it.
    private startSeconds(index: number): string | undefined {
        const row = this.rowAt(index)
        const picture = row?.presenter.read()
        if (!row || !picture) {
            return undefined
        }
        return (picture.start * row.presenter.durationSec()).toFixed(2)
    }

    private syncWarp() {
        const none = this.selected.length === 0
        const play = (index: number) => this.client.registry.playAt(index) ?? undefined
        const warp = none ? 'none' : this.shared((index) => play(index)?.warp)
        if (this.warpOutput) {
            this.warpOutput.dataset.value = warp ?? 'none'
            this.warpOutput.textContent = warp === undefined ? '---' : warp.toUpperCase()
        }
        const beat = this.beatInput
        if (beat) {
            // SIZE changes the sound only in beat and grain mode, so it is disabled unless every selected sample is in one of them.
            // Beat mode steps through beatSteps. Grain mode is continuous over grainSteps.
            const grain = warp === 'grain'
            beat.disabled = warp !== 'beat' && !grain
            const last = grain ? grainSteps : beatSteps.length - 1
            beat.max = String(last)
            const index = none ? 0 : this.shared((at) => {
                const param = play(at)?.warpParam
                return param === undefined ? undefined : Math.round(param * last)
            })
            this.writeRange(beat, index)
            placeThumb(beat)
            if (this.beatCaption) {
                const value = Number(beat.value)
                this.beatCaption.textContent =
                    index === undefined ? '--' : grain ? `${Math.round(grainMs(value / last))}ms` : (beatSteps[value] ?? '')
            }
        }
        const bpm = this.bpmInput
        if (bpm && document.activeElement !== bpm) {
            const value = none ? 120 : this.shared((index) => play(index)?.bpm)
            bpm.value = value === undefined ? '--' : value.toFixed(1)
        }
    }

    private syncPanel() {
        this.syncWarp()
        const first = this.selected.length > 0 ? this.rowAt(this.selected[0]) : null
        const duration = first?.presenter.durationSec() ?? 0
        const picture = (index: number) => this.rowAt(index)?.presenter.read() ?? undefined
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
        if (this.selected.length === 0) {
            this.writeRange(volume, 1)
            this.writeRange(pan, 0)
            this.writeRange(start, 0)
            this.writeRange(length, 1)
            this.writeStartTime(startTime, 0)
            if (document.activeElement !== loop) {
                loop.indeterminate = false
                loop.checked = false
            }
            return
        }
        // A control whose value differs between the selected rows shows no value.
        this.writeRange(volume, this.shared((index) => picture(index)?.volume))
        this.writeRange(pan, this.shared((index) => picture(index)?.pan))
        this.writeRange(start, this.shared((index) => picture(index)?.start))
        this.writeRange(length, this.shared((index) => picture(index)?.length))
        const seconds = this.shared((index) => this.startSeconds(index))
        this.writeStartTime(startTime, seconds === undefined ? undefined : Number(seconds))
        const looped = this.shared((index) => picture(index)?.loop)
        if (document.activeElement !== loop) {
            loop.indeterminate = looped === undefined
            loop.checked = looped ?? false
        }
    }

    private writeStartTime(input: HTMLInputElement, seconds: number | undefined) {
        if (document.activeElement === input) {
            return
        }
        if (seconds === undefined) {
            input.value = '--'
            return
        }
        const limit = Number(input.dataset.max)
        const capped = Number.isFinite(limit) ? Math.min(limit, Math.max(0, seconds)) : Math.max(0, seconds)
        const shown = capped.toFixed(2)
        if (input.value !== shown) {
            input.value = shown
        }
    }

    // Undefined hides the thumb: the selected rows differ.
    private writeRange(input: HTMLInputElement, value: number | undefined) {
        input.closest('.slider')?.classList.toggle('mixed', value === undefined)
        if (document.activeElement === input || value === undefined) {
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
        // Rows after the removed one move up. Several removals come highest first.
        this.selected = this.selected.filter((at) => at !== index).map((at) => (at > index ? at - 1 : at))
        this.selectionListener(this.selected)
        await this.client.removeAt(index)
    }

    private async clear() {
        if (!this.model.hasTracks) {
            return
        }
        this.selected = []
        this.selectionListener(this.selected)
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


