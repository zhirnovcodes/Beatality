export interface SampleSettings {
    start: number
    length: number
    loop: boolean
    volume: number
    pan: number
}

export interface PackTrack {
    source: { type: 'internal'; id: string } | { type: 'file'; path: string }
    volume: number
    start: number
    pan: number
    length: number
    loop: boolean
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
    pan: number
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
    if (bpm === null || !(bpm > 0) || loop === null || slices === null || attack === null || volume === null || pan === null) {
        return null
    }
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
        pan: clamp(pan, -1, 1),
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
    return {
        source,
        volume: clamp(volume, 0, 1.2),
        start: unit(start),
        pan: clamp(pan, -1, 1),
        length: unit(length),
        loop: record.loop,
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
