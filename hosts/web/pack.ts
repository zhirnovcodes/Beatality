// In the engine's order: the index is the mode number bt_set_track takes.
export const warpModes = ['none', 'beat', 'pitch'] as const
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
    sequence: { savedCount: number; slots: number[] }
    tracks: PackTrack[]
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
        sequence,
        tracks,
    }
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
