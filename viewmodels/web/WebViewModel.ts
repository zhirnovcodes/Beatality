import { chaosTriggerNames, type PackDocument } from '../../hosts/web/pack'

export interface TrackRow {
    name: string
    missing: boolean
}

export interface FactoryBank {
    name: string
    file: string
}

// The chaos knobs. trigger is 0 Randomize button, 1 Note, 2 Loop, 3 Slices, 4 Beats.
// beatSize is 2^n beats, -2..1. loopSize is loops, 1..8. sliceSize is 2^n slices, -1..2.
// groups is one toggle per chaosGroupNames entry, in that order.
export interface ChaosState {
    trigger: number
    value: number
    beatSize: number
    loopSize: number
    sliceSize: number
    groups: boolean[]
}

// The knobs a chaos roll can change, as the engine plays them.
export interface RolledControls {
    panMin: number
    panMax: number
    sliceExp: number
    attackMs: number
    effectsEnabled: boolean
    globalPower: number
    globalChance: number
    beatMin: number
    beatMax: number
    delayPower: number
    delayChance: number
    reverbPower: number
    reverbChance: number
    reversePower: number
    reverseChance: number
    filterPower: number
    filterChance: number
    flangerPower: number
    flangerChance: number
    trancePower: number
    tranceChance: number
    shiftPower: number
    shiftChance: number
    repeatEnabled: boolean
    repeatSizeMin: number
    repeatSizeMax: number
    repeatLength: number
    repeatChance: number
    repeatMix: number
    repeatPositions: boolean[]
    chaosValue: number
    chaosBeatSize: number
    chaosLoopSize: number
    chaosSliceSize: number
}

export const chaosTriggers = ['Randomize button', 'Note', 'Loop', 'Slices', 'Beats']
export const chaosGroupNames = [
    'Pan',
    'Slices',
    'Randomize',
    'Effects (global)',
    'Effects on/off',
    'Effects (private)',
    'Beat repeat on/off',
    'Beat repeat positions',
    'Beat repeat params',
    'Chaos value',
    'Chaos time',
]

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
    // Off, the first note starts the loop where the project playhead is.
    setRetrig: (on: boolean) => void
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
    setChaos: (chaos: ChaosState) => void
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

function randomUnit(): number {
    return Math.round(Math.random() * 100) / 100
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
    retrig = true
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
    chaosTrigger = 0
    chaosValue = 0
    chaosBeatSize = 0
    chaosLoopSize = 1
    chaosSliceSize = 0
    chaosGroups: boolean[] = Array(chaosGroupNames.length).fill(false)
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

    setRetrig(on: boolean) {
        if (on === this.retrig) {
            return
        }
        this.retrig = on
        this.notify()
        this.actions?.setRetrig(on)
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

    // The Shuffle button. A random power and chance for each effect, and a random effect time range.
    shuffleEffects() {
        this.setGlobalPower(randomUnit())
        this.setGlobalChance(randomUnit())
        const a = -4 + Math.floor(Math.random() * 6)
        const b = -4 + Math.floor(Math.random() * 6)
        this.setGlobalBeatMin(Math.min(a, b))
        this.setGlobalBeatMax(Math.max(a, b))
        this.setDelayPower(randomUnit())
        this.setDelayChance(randomUnit())
        this.setReverbPower(randomUnit())
        this.setReverbChance(randomUnit())
        this.setReversePower(randomUnit())
        this.setReverseChance(randomUnit())
        this.setFilterPower(randomUnit())
        this.setFilterChance(randomUnit())
        this.setFlangerPower(randomUnit())
        this.setFlangerChance(randomUnit())
        this.setTrancePower(randomUnit())
        this.setTranceChance(randomUnit())
        this.setShiftPower(randomUnit())
        this.setShiftChance(randomUnit())
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

    setChaosTrigger(trigger: number) {
        if (!Number.isInteger(trigger) || trigger < 0 || trigger >= chaosTriggers.length || trigger === this.chaosTrigger) {
            return
        }
        this.chaosTrigger = trigger
        this.sendChaos()
    }

    setChaosValue(value: number) {
        if (!Number.isFinite(value) || value < 0 || value > 1 || value === this.chaosValue) {
            return
        }
        this.chaosValue = value
        this.sendChaos()
    }

    setChaosGroup(group: number, on: boolean) {
        if (!Number.isInteger(group) || group < 0 || group >= chaosGroupNames.length || on === this.chaosGroups[group]) {
            return
        }
        this.chaosGroups = this.chaosGroups.map((value, i) => (i === group ? on : value))
        this.sendChaos()
    }

    // 2^exponent beats, -2..1.
    setChaosBeatSize(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < -2 || exponent > 1 || exponent === this.chaosBeatSize) {
            return
        }
        this.chaosBeatSize = exponent
        this.sendChaos()
    }

    // Loops, 1..8.
    setChaosLoopSize(loops: number) {
        if (!Number.isInteger(loops) || loops < 1 || loops > 8 || loops === this.chaosLoopSize) {
            return
        }
        this.chaosLoopSize = loops
        this.sendChaos()
    }

    // 2^exponent slices, -1..2.
    setChaosSliceSize(exponent: number) {
        if (!Number.isInteger(exponent) || exponent < -1 || exponent > 2 || exponent === this.chaosSliceSize) {
            return
        }
        this.chaosSliceSize = exponent
        this.sendChaos()
    }

    // The pack knobs the install message does not carry: sync, retrig, effects, beat repeat, and chaos.
    // Each one goes through its setter, which sends it to the engine.
    applyPack(doc: PackDocument) {
        this.setBpmSync(doc.bpmSync)
        this.setRetrig(doc.retrig)
        const effects = doc.effects
        this.setEffectsEnabled(effects.enabled)
        this.setGlobalPower(effects.globalPower)
        this.setGlobalChance(effects.globalChance)
        // Min first pushes max up past it; max then pulls min down. Either order ends on the pack's range.
        this.setGlobalBeatMin(effects.beatMin)
        this.setGlobalBeatMax(effects.beatMax)
        this.setDelayPower(effects.delayPower)
        this.setDelayChance(effects.delayChance)
        this.setReverbPower(effects.reverbPower)
        this.setReverbChance(effects.reverbChance)
        this.setReversePower(effects.reversePower)
        this.setReverseChance(effects.reverseChance)
        this.setFilterPower(effects.filterPower)
        this.setFilterChance(effects.filterChance)
        this.setFlangerPower(effects.flangerPower)
        this.setFlangerChance(effects.flangerChance)
        this.setTrancePower(effects.trancePower)
        this.setTranceChance(effects.tranceChance)
        this.setShiftPower(effects.shiftPower)
        this.setShiftChance(effects.shiftChance)
        const repeat = doc.repeat
        this.setRepeatEnabled(repeat.enabled)
        this.setRepeatSizeMin(repeat.sizeMin)
        this.setRepeatSizeMax(repeat.sizeMax)
        this.setRepeatLength(repeat.length)
        this.setRepeatChance(repeat.chance)
        this.setRepeatMix(repeat.mix)
        repeat.positions.forEach((on, index) => this.setRepeatPosition(index, on))
        const chaos = doc.chaos
        this.setChaosTrigger(chaosTriggerNames.indexOf(chaos.trigger))
        this.setChaosValue(chaos.value)
        this.setChaosBeatSize(chaos.beatSize)
        this.setChaosLoopSize(chaos.loopSize)
        this.setChaosSliceSize(chaos.sliceSize)
        chaos.groups.forEach((on, index) => this.setChaosGroup(index, on))
    }

    // What a chaos roll set on the engine. Shown, not sent back.
    adoptControls(controls: RolledControls) {
        this.outputPanMin = controls.panMin
        this.outputPanMax = controls.panMax
        this.sliceExp = fitSlice(controls.sliceExp, this.loopBeats)
        this.attackMs = controls.attackMs
        this.effectsEnabled = controls.effectsEnabled
        this.globalPower = controls.globalPower
        this.globalChance = controls.globalChance
        this.globalBeatMinExp = controls.beatMin
        this.globalBeatMaxExp = controls.beatMax
        this.delayPower = controls.delayPower
        this.delayChance = controls.delayChance
        this.reverbPower = controls.reverbPower
        this.reverbChance = controls.reverbChance
        this.reversePower = controls.reversePower
        this.reverseChance = controls.reverseChance
        this.filterPower = controls.filterPower
        this.filterChance = controls.filterChance
        this.flangerPower = controls.flangerPower
        this.flangerChance = controls.flangerChance
        this.trancePower = controls.trancePower
        this.tranceChance = controls.tranceChance
        this.shiftPower = controls.shiftPower
        this.shiftChance = controls.shiftChance
        this.repeatEnabled = controls.repeatEnabled
        this.repeatSizeMinExp = controls.repeatSizeMin
        this.repeatSizeMaxExp = controls.repeatSizeMax
        this.repeatLengthExp = controls.repeatLength
        this.repeatChance = controls.repeatChance
        this.repeatMix = controls.repeatMix
        this.repeatPositions = [...controls.repeatPositions]
        this.chaosValue = controls.chaosValue
        this.chaosBeatSize = controls.chaosBeatSize
        this.chaosLoopSize = controls.chaosLoopSize
        this.chaosSliceSize = controls.chaosSliceSize
        this.notify()
    }

    private sendChaos() {
        this.notify()
        this.actions?.setChaos({
            trigger: this.chaosTrigger,
            value: this.chaosValue,
            beatSize: this.chaosBeatSize,
            loopSize: this.chaosLoopSize,
            sliceSize: this.chaosSliceSize,
            groups: [...this.chaosGroups],
        })
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
