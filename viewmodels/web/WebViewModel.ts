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
    setEffectsEnabled: (on: boolean) => void
    setGlobalBeatRange: (min: number, max: number) => void
    setGlobalChance: (chance: number) => void
    setReverbPower: (power: number) => void
    setReverbChance: (chance: number) => void
    setDelayPower: (power: number) => void
    setDelayChance: (chance: number) => void
    setReversePower: (power: number) => void
    setReverseChance: (chance: number) => void
    setFilterPower: (power: number) => void
    setFilterChance: (chance: number) => void
    setFlangerPower: (power: number) => void
    setFlangerChance: (chance: number) => void
    setTrancePower: (power: number) => void
    setTranceChance: (chance: number) => void
    setShiftPower: (power: number) => void
    setShiftChance: (chance: number) => void
    setRepeatEnabled: (on: boolean) => void
    setRepeatSizeRange: (min: number, max: number) => void
    setRepeatLength: (exponent: number) => void
    setRepeatChance: (chance: number) => void
    setRepeatPosition: (index: number, on: boolean) => void
    setRepeatMix: (mix: number) => void
    setOutput: (volume: number, panMin: number, panMax: number) => void
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
const repeatSizeMin = -5
const repeatSizeMax = 1
const repeatLengthMin = -4
const repeatLengthMax = 1
const repeatPositionCount = 8

function sliceBeats(exponent: number): number {
    return 2 ** exponent
}

function unit(value: number): number {
    if (!(value >= 0)) {
        return 0
    }
    return value > 1 ? 1 : value
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) {
        return min
    }
    return value > max ? max : value
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
    // The host's tempo. While bpmSync is on, the engine plays this instead of bpm.
    bpmSync = false
    projectBpm = 120
    loopBeats = 8
    sliceExp = 0
    attackMs = 2
    effectsEnabled = true
    globalPower = 1
    globalBeatMinExp = -3
    globalBeatMaxExp = -1
    globalChance = 0
    reverbPower = 1
    reverbChance = 0
    delayPower = 1
    delayChance = 0
    reversePower = 1
    reverseChance = 0
    filterPower = 1
    filterChance = 0
    flangerPower = 1
    flangerChance = 0
    trancePower = 1
    tranceChance = 0
    shiftPower = 1
    shiftChance = 0
    repeatEnabled = false
    repeatSizeMinExp = 0
    repeatSizeMaxExp = 0
    repeatLengthExp = 0
    repeatChance = 0
    repeatPositions: boolean[] = Array(repeatPositionCount).fill(false)
    repeatMix = 1
    outputVolume = 1
    outputPanMin = 0
    outputPanMax = 0
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
    adopt(settings: { bpm: number; loopBeats: number; sliceExp: number; attackMs: number; outputVolume: number; outputPanMin: number; outputPanMax: number }) {
        this.bpm = settings.bpm
        this.loopBeats = settings.loopBeats
        this.sliceExp = fitSlice(settings.sliceExp, settings.loopBeats)
        this.attackMs = settings.attackMs
        this.outputVolume = settings.outputVolume
        this.outputPanMin = settings.outputPanMin
        this.outputPanMax = settings.outputPanMax
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

    // The tempo the engine plays.
    get engineBpm(): number {
        return this.bpmSync ? this.projectBpm : this.bpm
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
        if (!this.bpmSync) {
            this.actions?.setBpm(bpm)
        }
    }

    setBpmSync(on: boolean) {
        if (on === this.bpmSync) {
            return
        }
        this.bpmSync = on
        this.notify()
        this.actions?.setBpm(this.engineBpm)
    }

    setProjectBpm(bpm: number) {
        if (!(bpm > 0) || !Number.isFinite(bpm)) {
            return
        }
        if (bpm === this.projectBpm) {
            return
        }
        this.projectBpm = bpm
        this.notify()
        if (this.bpmSync) {
            this.actions?.setBpm(bpm)
        }
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

    setEffectsEnabled(on: boolean) {
        if (on === this.effectsEnabled) {
            return
        }
        this.effectsEnabled = on
        this.notify()
        this.actions?.setEffectsEnabled(on)
    }

    // Moving min past max pushes max along, and the other way round, so min never passes max.
    setGlobalBeatMin(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < beatExpMin || exponent > beatExpMax) {
            return
        }
        this.setGlobalBeatRange(exponent, Math.max(exponent, this.globalBeatMaxExp))
    }

    setGlobalBeatMax(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < beatExpMin || exponent > beatExpMax) {
            return
        }
        this.setGlobalBeatRange(Math.min(exponent, this.globalBeatMinExp), exponent)
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

    setFlangerPower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.flangerPower) {
            return
        }
        this.flangerPower = power
        this.notify()
        this.actions?.setFlangerPower(power)
    }

    setFlangerChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.flangerChance) {
            return
        }
        this.flangerChance = chance
        this.notify()
        this.actions?.setFlangerChance(chance)
    }

    setTrancePower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.trancePower) {
            return
        }
        this.trancePower = power
        this.notify()
        this.actions?.setTrancePower(power)
    }

    setTranceChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.tranceChance) {
            return
        }
        this.tranceChance = chance
        this.notify()
        this.actions?.setTranceChance(chance)
    }

    setShiftPower(power: number) {
        if (!Number.isFinite(power) || power < 0 || power > 1) {
            return
        }
        if (power === this.shiftPower) {
            return
        }
        this.shiftPower = power
        this.notify()
        this.actions?.setShiftPower(power)
    }

    setShiftChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.shiftChance) {
            return
        }
        this.shiftChance = chance
        this.notify()
        this.actions?.setShiftChance(chance)
    }

    setRepeatEnabled(on: boolean) {
        if (on === this.repeatEnabled) {
            return
        }
        this.repeatEnabled = on
        this.notify()
        this.actions?.setRepeatEnabled(on)
    }

    // Moving min past max pushes max along, and the other way round, so min never passes max.
    setRepeatSizeMin(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < repeatSizeMin || exponent > repeatSizeMax) {
            return
        }
        this.setRepeatSizeRange(exponent, Math.max(exponent, this.repeatSizeMaxExp))
    }

    setRepeatSizeMax(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < repeatSizeMin || exponent > repeatSizeMax) {
            return
        }
        this.setRepeatSizeRange(Math.min(exponent, this.repeatSizeMinExp), exponent)
    }

    setRepeatLength(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < repeatLengthMin || exponent > repeatLengthMax) {
            return
        }
        if (exponent === this.repeatLengthExp) {
            return
        }
        this.repeatLengthExp = exponent
        this.notify()
        this.actions?.setRepeatLength(exponent)
    }

    setRepeatChance(chance: number) {
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            return
        }
        if (chance === this.repeatChance) {
            return
        }
        this.repeatChance = chance
        this.notify()
        this.actions?.setRepeatChance(chance)
    }

    setRepeatPosition(index: number, on: boolean) {
        if (!Number.isInteger(index) || index < 0 || index >= repeatPositionCount) {
            return
        }
        if (on === this.repeatPositions[index]) {
            return
        }
        this.repeatPositions = this.repeatPositions.map((value, i) => (i === index ? on : value))
        this.notify()
        this.actions?.setRepeatPosition(index, on)
    }

    setRepeatMix(mix: number) {
        if (!Number.isFinite(mix) || mix < 0 || mix > 1) {
            return
        }
        if (mix === this.repeatMix) {
            return
        }
        this.repeatMix = mix
        this.notify()
        this.actions?.setRepeatMix(mix)
    }

    private setGlobalBeatRange(min: number, max: number) {
        if (min === this.globalBeatMinExp && max === this.globalBeatMaxExp) {
            return
        }
        this.globalBeatMinExp = min
        this.globalBeatMaxExp = max
        this.notify()
        this.actions?.setGlobalBeatRange(min, max)
    }

    private setRepeatSizeRange(min: number, max: number) {
        if (min === this.repeatSizeMinExp && max === this.repeatSizeMaxExp) {
            return
        }
        this.repeatSizeMinExp = min
        this.repeatSizeMaxExp = max
        this.notify()
        this.actions?.setRepeatSizeRange(min, max)
    }

    // Master mix. Volume is 0..1.2. Each pan end is -1..1.
    // Each slice's pan roll is scaled onto panMin..panMax.
    // The mouse snaps to 1 and 0 before it calls here. Automation does not snap.
    setOutput(volume: number, panMin: number, panMax: number) {
        if (!Number.isFinite(volume) || !Number.isFinite(panMin) || !Number.isFinite(panMax)) {
            return
        }
        const nextVolume = clamp(volume, 0, 1.2)
        const nextPanMin = clamp(panMin, -1, 1)
        const nextPanMax = Math.max(nextPanMin, clamp(panMax, -1, 1))
        if (nextVolume === this.outputVolume && nextPanMin === this.outputPanMin && nextPanMax === this.outputPanMax) {
            return
        }
        this.outputVolume = nextVolume
        this.outputPanMin = nextPanMin
        this.outputPanMax = nextPanMax
        this.notify()
        this.actions?.setOutput(nextVolume, nextPanMin, nextPanMax)
    }

    // Moving min past max pushes max along, and the other way round, so min never passes max.
    setOutputPanMin(pan: number) {
        if (!Number.isFinite(pan)) {
            return
        }
        const next = clamp(pan, -1, 1)
        this.setOutput(this.outputVolume, next, Math.max(next, this.outputPanMax))
    }

    setOutputPanMax(pan: number) {
        if (!Number.isFinite(pan)) {
            return
        }
        const next = clamp(pan, -1, 1)
        this.setOutput(this.outputVolume, Math.min(next, this.outputPanMin), next)
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
