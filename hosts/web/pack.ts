// In the engine's order: the index is the mode number bt_set_track takes.
export const warpModes = ['none', 'beat', 'pitch', 'grain'] as const
export type WarpMode = (typeof warpModes)[number]

// bpm is the sample's own tempo, 1.0..999.9 in steps of 0.1. warpParam is 0..1.
export interface SampleSettings {
    start: number
    length: number
    loop: boolean
    volume: number
    pan: number
    warp: WarpMode
    bpm: number
    warpParam: number
}

// warp, bpm, and warpParam may be missing from older packs. They read as none, 120, and 0.
export interface PackTrack {
    source: { type: 'internal'; id: string } | { type: 'file'; path: string }
    volume: number
    start: number
    pan: number
    length: number
    loop: boolean
    warp: WarpMode
    bpm: number
    warpParam: number
}

export interface PackDocument {
    format: 'beatality.pack'
    version: 1
    name: string
    bpm: number
    loop: number
    slices: number
    attack: number
    volume: number
    // Each slice's pan roll is scaled onto panMin..panMax. Older packs have one pan, read as both.
    panMin: number
    panMax: number
    // Packs without these read as the engine defaults, sync off, and retrig on.
    bpmSync: boolean
    retrig: boolean
    effects: PackEffects
    repeat: PackRepeat
    chaos: PackChaos
    sequence: { savedCount: number; slots: number[] }
    tracks: PackTrack[]
}

// bt::Effects. beatMin and beatMax are exponents, -4..1.
export interface PackEffects {
    enabled: boolean
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
}

// bt::BeatRepeatSettings. sizeMin and sizeMax are -5..1, length is -4..1. positions are the 8 loop parts.
export interface PackRepeat {
    enabled: boolean
    sizeMin: number
    sizeMax: number
    length: number
    chance: number
    mix: number
    positions: boolean[]
}

// bt::ChaosSettings. trigger is a bt::ChaosTrigger name. groups are in bt::ChaosGroup order.
export const chaosTriggerNames = ['note', 'loop', 'slices', 'beats', 'none'] as const
export type ChaosTriggerName = (typeof chaosTriggerNames)[number]

export interface PackChaos {
    trigger: ChaosTriggerName
    value: number
    beatSize: number
    loopSize: number
    sliceSize: number
    groups: boolean[]
}

const repeatPositions = 8
const chaosGroups = 11

export function defaultEffects(): PackEffects {
    return {
        enabled: true,
        globalPower: 1,
        globalChance: 0,
        beatMin: -3,
        beatMax: -1,
        delayPower: 1,
        delayChance: 0,
        reverbPower: 1,
        reverbChance: 0,
        reversePower: 1,
        reverseChance: 0,
        filterPower: 1,
        filterChance: 0,
        flangerPower: 1,
        flangerChance: 0,
        trancePower: 1,
        tranceChance: 0,
        shiftPower: 1,
        shiftChance: 0,
    }
}

export function defaultRepeat(): PackRepeat {
    return { enabled: false, sizeMin: 0, sizeMax: 0, length: 0, chance: 0, mix: 1, positions: Array(repeatPositions).fill(false) }
}

export function defaultChaos(): PackChaos {
    return { trigger: 'none', value: 0, beatSize: 0, loopSize: 1, sliceSize: 0, groups: Array(chaosGroups).fill(false) }
}

export interface FactoryBank {
    name: string
    file: string
}

const expMin = -4
const expMax = 4

function sliceBeats(exponent: number): number {
    return 2 ** exponent
}

function fitSlice(exponent: number, loopBeats: number): number {
    let fitted = exponent
    while (sliceBeats(fitted) > loopBeats) {
        fitted -= 1
    }
    return fitted
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
    if (value > max) {
        return max
    }
    return value
}

function integer(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return null
    }
    return value
}

function finite(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null
    }
    return value
}

// One decimal place, 1.0 to 999.9.
export function sampleBpm(value: number): number {
    return clamp(Math.round(value * 10) / 10, 1, 999.9)
}

export function warpIndex(mode: WarpMode): number {
    return warpModes.indexOf(mode)
}

function decodeWarp(value: unknown): WarpMode {
    return warpModes.find((mode) => mode === value) ?? 'none'
}

// The same document the plugin writes. Null when the text is not a version-1 pack.
export function decodePack(text: string): PackDocument | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const record = parsed as Record<string, unknown>
    if (record.format !== 'beatality.pack' || record.version !== 1) {
        return null
    }
    const name = typeof record.name === 'string' ? record.name : 'Pack'
    const bpm = finite(record.bpm)
    const loop = integer(record.loop)
    const slices = integer(record.slices)
    const attack = integer(record.attack)
    const volume = finite(record.volume)
    const pan = finite(record.pan)
    const panMin = finite(record.panMin) ?? pan
    const panMax = finite(record.panMax) ?? pan
    if (bpm === null || !(bpm > 0) || loop === null || slices === null || attack === null || volume === null || panMin === null || panMax === null) {
        return null
    }
    const fittedPanMin = clamp(panMin, -1, 1)
    const fittedLoop = clamp(loop, 1, 32)
    const fittedSlice = fitSlice(clamp(slices, expMin, expMax), fittedLoop)
    const sequence = decodeSequence(record.sequence)
    const tracks = decodeTracks(record.tracks)
    if (!sequence || !tracks) {
        return null
    }
    return {
        format: 'beatality.pack',
        version: 1,
        name,
        bpm: clamp(Math.round(bpm), 1, 999),
        loop: fittedLoop,
        slices: fittedSlice,
        attack: clamp(attack, 2, 16),
        volume: clamp(volume, 0, 1.2),
        panMin: fittedPanMin,
        panMax: clamp(panMax, fittedPanMin, 1),
        bpmSync: typeof record.bpmSync === 'boolean' ? record.bpmSync : false,
        retrig: typeof record.retrig === 'boolean' ? record.retrig : true,
        effects: decodeEffects(record.effects),
        repeat: decodeRepeat(record.repeat),
        chaos: decodeChaos(record.chaos),
        sequence,
        tracks,
    }
}

// The same text the plugin writes.
export function encodePack(doc: PackDocument): string {
    return JSON.stringify(doc, null, 2)
}

function objectOf(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

// A missing or broken field keeps its fallback.
function numberIn(record: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
    const value = finite(record[key])
    return value === null ? fallback : clamp(value, min, max)
}

function wholeIn(record: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
    return Math.round(numberIn(record, key, fallback, min, max))
}

function flagIn(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = record[key]
    return typeof value === 'boolean' ? value : fallback
}

function flagList(value: unknown, fallback: boolean[]): boolean[] {
    if (!Array.isArray(value)) {
        return fallback
    }
    return fallback.map((_, i) => value[i] === true)
}

function decodeEffects(value: unknown): PackEffects {
    const effects = defaultEffects()
    const record = objectOf(value)
    if (!record) {
        return effects
    }
    effects.enabled = flagIn(record, 'enabled', effects.enabled)
    effects.beatMin = wholeIn(record, 'beatMin', effects.beatMin, -4, 1)
    effects.beatMax = wholeIn(record, 'beatMax', effects.beatMax, effects.beatMin, 1)
    const units = [
        'globalPower',
        'globalChance',
        'delayPower',
        'delayChance',
        'reverbPower',
        'reverbChance',
        'reversePower',
        'reverseChance',
        'filterPower',
        'filterChance',
        'flangerPower',
        'flangerChance',
        'trancePower',
        'tranceChance',
        'shiftPower',
        'shiftChance',
    ] as const
    for (const key of units) {
        effects[key] = numberIn(record, key, effects[key], 0, 1)
    }
    return effects
}

function decodeRepeat(value: unknown): PackRepeat {
    const repeat = defaultRepeat()
    const record = objectOf(value)
    if (!record) {
        return repeat
    }
    repeat.enabled = flagIn(record, 'enabled', repeat.enabled)
    repeat.sizeMin = wholeIn(record, 'sizeMin', repeat.sizeMin, -5, 1)
    repeat.sizeMax = wholeIn(record, 'sizeMax', repeat.sizeMax, repeat.sizeMin, 1)
    repeat.length = wholeIn(record, 'length', repeat.length, -4, 1)
    repeat.chance = numberIn(record, 'chance', repeat.chance, 0, 1)
    repeat.mix = numberIn(record, 'mix', repeat.mix, 0, 1)
    repeat.positions = flagList(record.positions, repeat.positions)
    return repeat
}

function decodeChaos(value: unknown): PackChaos {
    const chaos = defaultChaos()
    const record = objectOf(value)
    if (!record) {
        return chaos
    }
    chaos.trigger = chaosTriggerNames.find((name) => name === record.trigger) ?? chaos.trigger
    chaos.value = numberIn(record, 'value', chaos.value, 0, 1)
    chaos.beatSize = wholeIn(record, 'beatSize', chaos.beatSize, -2, 1)
    chaos.loopSize = wholeIn(record, 'loopSize', chaos.loopSize, 1, 8)
    chaos.sliceSize = wholeIn(record, 'sliceSize', chaos.sliceSize, -1, 2)
    chaos.groups = flagList(record.groups, chaos.groups)
    return chaos
}

function decodeSequence(value: unknown): { savedCount: number; slots: number[] } | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    const savedCount = integer(record.savedCount)
    if (savedCount === null || savedCount < 0 || !Array.isArray(record.slots) || record.slots.length > 2048) {
        return null
    }
    if (record.slots.length > 0 && savedCount < 1) {
        return null
    }
    const slots: number[] = []
    for (const slot of record.slots) {
        const index = integer(slot)
        if (index === null || index < 0 || index >= savedCount) {
            return null
        }
        slots.push(index)
    }
    return { savedCount, slots }
}

function decodeTracks(value: unknown): PackTrack[] | null {
    if (!Array.isArray(value) || value.length > 32) {
        return null
    }
    const tracks: PackTrack[] = []
    for (const item of value) {
        const track = decodeTrack(item)
        if (!track) {
            return null
        }
        tracks.push(track)
    }
    return tracks
}

function decodeTrack(value: unknown): PackTrack | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    const source = decodeSource(record.source)
    const volume = finite(record.volume)
    const start = finite(record.start)
    const pan = finite(record.pan)
    const length = finite(record.length)
    if (!source || volume === null || start === null || pan === null || length === null || typeof record.loop !== 'boolean') {
        return null
    }
    const bpm = finite(record.bpm)
    return {
        source,
        volume: clamp(volume, 0, 1.2),
        start: unit(start),
        pan: clamp(pan, -1, 1),
        length: unit(length),
        loop: record.loop,
        warp: decodeWarp(record.warp),
        bpm: bpm === null ? 120 : sampleBpm(bpm),
        warpParam: unit(finite(record.warpParam) ?? 0),
    }
}

function decodeSource(value: unknown): PackTrack['source'] | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    if (record.type === 'internal' && typeof record.id === 'string' && record.id.length > 0) {
        return { type: 'internal', id: record.id }
    }
    if (record.type === 'file' && typeof record.path === 'string') {
        return { type: 'file', path: record.path }
    }
    return null
}

export function decodeBanks(value: unknown): FactoryBank[] {
    if (!Array.isArray(value)) {
        return []
    }
    const banks: FactoryBank[] = []
    for (const item of value) {
        if (typeof item !== 'object' || item === null) {
            continue
        }
        const record = item as Record<string, unknown>
        if (typeof record.name === 'string' && typeof record.file === 'string' && record.file.length > 0) {
            banks.push({ name: record.name, file: record.file })
        }
    }
    return banks
}
