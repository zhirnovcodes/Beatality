import type { SampleSettings } from '../pack'

// Left and right, one sample per frame. `samples` is the left channel.
export interface TrackWave {
    samples: Float32Array
    right: Float32Array
    sampleRate: number
}

// File names in list order, the waveform the page draws, and the ids the audio thread uses.
export class TrackRegistry {
    static readonly capacity = 32
    static readonly defaultPlay: SampleSettings = {
        start: 0,
        length: 1,
        loop: false,
        volume: 1,
        pan: 0,
        warp: 'none',
        bpm: 120,
        warpParam: 0,
    }

    private names: string[] = []
    private waves: TrackWave[] = []
    private missing: boolean[] = []
    private plays: SampleSettings[] = []
    // The file each track was decoded from, kept so a preset can be saved. Null when missing.
    private files: (File | null)[] = []
    private nextId = 1

    get count(): number {
        return this.names.length
    }

    list(): string[] {
        return this.names.slice()
    }

    wave(index: number): TrackWave | null {
        return this.waves[index] ?? null
    }

    missingAt(index: number): boolean {
        return this.missing[index] ?? false
    }

    missingList(): boolean[] {
        return this.missing.slice()
    }

    playAt(index: number): SampleSettings | null {
        return this.plays[index] ?? null
    }

    fileAt(index: number): File | null {
        return this.files[index] ?? null
    }

    setPlay(index: number, play: SampleSettings): void {
        if (this.plays[index]) {
            this.plays[index] = play
        }
    }

    // Null when the list is full. Ids start at 1 and are never reused.
    add(name: string, wave: TrackWave, missing = false, play: SampleSettings = TrackRegistry.defaultPlay, file: File | null = null): number | null {
        if (this.names.length >= TrackRegistry.capacity) {
            return null
        }
        this.names.push(name)
        this.waves.push(wave)
        this.missing.push(missing)
        this.plays.push(play)
        this.files.push(file)
        return this.nextId++
    }

    removeAt(index: number): void {
        this.names.splice(index, 1)
        this.waves.splice(index, 1)
        this.missing.splice(index, 1)
        this.plays.splice(index, 1)
        this.files.splice(index, 1)
    }

    clear(): void {
        this.names = []
        this.waves = []
        this.missing = []
        this.plays = []
        this.files = []
    }
}
