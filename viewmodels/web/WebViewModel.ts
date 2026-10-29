export interface TrackRow {
    name: string
    missing: boolean
}

export interface FactoryBank {
    name: string
    file: string
}

export interface ViewActions {
    midi: (status: number, note: number, velocity: number) => void
    loadPack: (file: string) => Promise<void>
    save?: () => void
    loadFile?: () => void
    append: (files: File[]) => void
    remove: (index: number) => void
    clear: () => void
    randomize: () => void
    setBpm: (bpm: number) => void
    setLoop: (beats: number) => void
    setSlice: (exponent: number) => void
    setAttack: (ms: number) => void
    setGlobalPower: (power: number) => void
    setGlobalBeat: (exponent: number) => void
    setGlobalChance: (chance: number) => void
    setReverbPower: (power: number) => void
    setReverbChance: (chance: number) => void
    setDelayPower: (power: number) => void
    setDelayChance: (chance: number) => void
    setReversePower: (power: number) => void
    setReverseChance: (chance: number) => void
    setFilterPower: (power: number) => void
    setFilterChance: (chance: number) => void
    setOutput: (volume: number, pan: number) => void
}

export interface ViewState {
    names: string[]
    missing?: boolean[]
    playing: boolean
    // Null keeps the slice the page already shows.
    sliceExp: number | null
    // 0 at the start of the loop, just under 1 at the end.
    playhead: number
}

export interface SliceChoice {
    exponent: number
    label: string
}

const expMin = -4
const expMax = 4
const beatExpMin = -4
const beatExpMax = 1

function sliceBeats(exponent: number): number {
    return 2 ** exponent
}

function unit(value: number): number {
    if (!(value >= 0)) {
        return 0
    }
    return value > 1 ? 1 : value
}

function snapTo(value: number, min: number, max: number, target: number): number {
    let clamped = value
    if (clamped < min) {
        clamped = min
    } else if (clamped > max) {
        clamped = max
    }
    if (Math.abs(clamped - target) <= (max - min) * 0.04) {
        return target
    }
    return clamped
}

function sliceLabel(exponent: number): string {
    if (exponent >= 0) {
        return String(sliceBeats(exponent))
    }
    return `1/${sliceBeats(-exponent)}`
}

// The largest 2^n that is still no longer than the loop.
function fitSlice(exponent: number, loopBeats: number): number {
    let fitted = exponent
    while (sliceBeats(fitted) > loopBeats) {
        fitted -= 1
    }
    return fitted
}

// What the page shows, and the actions its controls send. No audio code.
export class WebViewModel {
    tracks: TrackRow[] = []
    playing = false
    playhead = 0
    error = ''
    bpm = 120
    loopBeats = 8
    sliceExp = 0
    attackMs = 2
    globalPower = 1
    globalBeatExp = 0
    globalChance = 0
    reverbPower = 1
    reverbChance = 0
    delayPower = 1
    delayChance = 0
    reversePower = 1
    reverseChance = 0
    filterPower = 1
    filterChance = 0
    outputVolume = 1
    outputPan = 0
    factoryBanks: FactoryBank[] = []

    private actions: ViewActions | null = null
    private listeners = new Set<() => void>()

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    bind(actions: ViewActions) {
        this.actions = actions
    }

    get hasTracks(): boolean {
        return this.tracks.length > 0
    }

    get canSave(): boolean {
        return this.actions?.save != null
    }

    get canLoadFile(): boolean {
        return this.actions?.loadFile != null
    }

    get sliceChoices(): SliceChoice[] {
        const choices: SliceChoice[] = []
        for (let exponent = expMin; exponent <= expMax; exponent++) {
            if (sliceBeats(exponent) <= this.loopBeats) {
                choices.push({ exponent, label: sliceLabel(exponent) })
            }
        }
        return choices
    }

    midi(status: number, note: number, velocity: number) {
        this.actions?.midi(status, note, velocity)
    }

    setFactoryBanks(banks: FactoryBank[]) {
        this.factoryBanks = banks
        this.notify()
    }

    loadPack(file: string): Promise<void> {
        return this.actions?.loadPack(file) ?? Promise.resolve()
    }

    save() {
        this.actions?.save?.()
    }

    loadFile() {
        this.actions?.loadFile?.()
    }

    // Pack settings, without sending them back to the engine.
    adopt(settings: { bpm: number; loopBeats: number; sliceExp: number; attackMs: number; outputVolume: number; outputPan: number }) {
        this.bpm = settings.bpm
        this.loopBeats = settings.loopBeats
        this.sliceExp = fitSlice(settings.sliceExp, settings.loopBeats)
        this.attackMs = settings.attackMs
        this.outputVolume = settings.outputVolume
        this.outputPan = settings.outputPan
        this.notify()
    }

    append(files: File[]) {
        if (files.length > 0) {
            this.actions?.append(files)
        }
    }

    remove(index: number) {
        this.actions?.remove(index)
    }

    clear() {
        this.actions?.clear()
    }

    randomize() {
        this.actions?.randomize()
    }

    setBpm(bpm: number) {
        if (!(bpm > 0) || !Number.isFinite(bpm)) {
            return
        }
        if (bpm === this.bpm) {
            return
        }
        this.bpm = bpm
        this.notify()
        this.actions?.setBpm(bpm)
    }

    setLoop(beats: number) {
        if (!Number.isInteger(beats) || beats < 1 || beats > 32) {
            return
        }
        const sliceExp = fitSlice(this.sliceExp, beats)
        if (beats === this.loopBeats && sliceExp === this.sliceExp) {
            return
        }
        this.loopBeats = beats
        this.sliceExp = sliceExp
        this.notify()
        this.actions?.setLoop(beats)
    }

    setSlice(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < expMin || exponent > expMax) {
            return
        }
        if (sliceBeats(exponent) > this.loopBeats || exponent === this.sliceExp) {
            return
        }
        this.sliceExp = exponent
        this.notify()
        this.actions?.setSlice(exponent)
    }

    setAttack(ms: number) {
        if (!Number.isInteger(ms) || ms < 2 || ms > 16) {
            return
        }
        if (ms === this.attackMs) {
            return
        }
        this.attackMs = ms
        this.notify()
        this.actions?.setAttack(ms)
    }

    setGlobalPower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.globalPower) {
            return
        }
        this.globalPower = power
        this.notify()
        this.actions?.setGlobalPower(power)
    }

    setGlobalBeat(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < beatExpMin || exponent > beatExpMax) {
            return
        }
        if (exponent === this.globalBeatExp) {
            return
        }
        this.globalBeatExp = exponent
        this.notify()
        this.actions?.setGlobalBeat(exponent)
    }

    setGlobalChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.globalChance) {
            return
        }
        this.globalChance = chance
        this.notify()
        this.actions?.setGlobalChance(chance)
    }

    setReverbPower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.reverbPower) {
            return
        }
        this.reverbPower = power
        this.notify()
        this.actions?.setReverbPower(power)
    }

    setReverbChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.reverbChance) {
            return
        }
        this.reverbChance = chance
        this.notify()
        this.actions?.setReverbChance(chance)
    }

    setDelayPower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.delayPower) {
            return
        }
        this.delayPower = power
        this.notify()
        this.actions?.setDelayPower(power)
    }

    setDelayChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.delayChance) {
            return
        }
        this.delayChance = chance
        this.notify()
        this.actions?.setDelayChance(chance)
    }

    setReversePower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.reversePower) {
            return
        }
        this.reversePower = power
        this.notify()
        this.actions?.setReversePower(power)
    }

    setReverseChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.reverseChance) {
            return
        }
        this.reverseChance = chance
        this.notify()
        this.actions?.setReverseChance(chance)
    }

    setFilterPower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.filterPower) {
            return
        }
        this.filterPower = power
        this.notify()
        this.actions?.setFilterPower(power)
    }

    setFilterChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.filterChance) {
            return
        }
        this.filterChance = chance
        this.notify()
        this.actions?.setFilterChance(chance)
    }

    // Master mix. Volume is 0..1.2 and snaps to 1. Pan is -1..1 and snaps to 0.
    setOutput(volume: number, pan: number) {
        if (!Number.isFinite(volume) || !Number.isFinite(pan)) {
            return
        }
        const nextVolume = snapTo(volume, 0, 1.2, 1)
        const nextPan = snapTo(pan, -1, 1, 0)
        if (nextVolume === this.outputVolume && nextPan === this.outputPan) {
            return
        }
        this.outputVolume = nextVolume
        this.outputPan = nextPan
        this.notify()
        this.actions?.setOutput(nextVolume, nextPan)
    }

    show(state: ViewState) {
        const tracks = state.names.map((name, index) => ({ name, missing: state.missing?.[index] ?? false }))
        const sliceExp = fitSlice(state.sliceExp ?? this.sliceExp, this.loopBeats)
        const playhead = unit(state.playhead)
        const sameTracks =
            tracks.length === this.tracks.length &&
            tracks.every((track, i) => track.name === this.tracks[i].name && track.missing === this.tracks[i].missing)
        const same = sameTracks && this.playing === state.playing && this.sliceExp === sliceExp
        if (same && this.playhead === playhead) {
            return
        }
        if (!same) {
            this.tracks = tracks
            this.playing = state.playing
            this.sliceExp = sliceExp
            this.error = ''
        }
        this.playhead = playhead
        this.notify()
    }

    fail(message: string) {
        this.error = message
        this.notify()
    }

    private notify() {
        for (const listener of this.listeners) {
            listener()
        }
    }
}
