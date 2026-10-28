import type { TrackPlay } from '../pack'

// Left and right, one sample per frame. `samples` is the left channel.
export interface TrackWave {
    samples: Float32Array
    right: Float32Array
    sampleRate: number
}

const defaultPlay: TrackPlay = { start: 0, length: 1, loop: false, volume: 1, pan: 0 }

// File names in list order, the waveform the page draws, and the ids the audio thread uses.
export class TrackRegistry {
    static readonly capacity = 32

    private names: string[] = []
    private waves: TrackWave[] = []
    private missing: boolean[] = []
    private plays: TrackPlay[] = []
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

    playAt(index: number): TrackPlay | null {
        return this.plays[index] ?? null
    }

    setPlay(index: number, play: TrackPlay): void {
        if (this.plays[index]) {
            this.plays[index] = play
        }
    }

    // Null when the list is full. Ids start at 1 and are never reused.
    add(name: string, wave: TrackWave, missing = false, play: TrackPlay = defaultPlay): number | null {
        if (this.names.length >= TrackRegistry.capacity) {
            return null
        }
        this.names.push(name)
        this.waves.push(wave)
        this.missing.push(missing)
        this.plays.push(play)
        return this.nextId++
    }

    removeAt(index: number): void {
        this.names.splice(index, 1)
        this.waves.splice(index, 1)
        this.missing.splice(index, 1)
        this.plays.splice(index, 1)
    }

    clear(): void {
        this.names = []
        this.waves = []
        this.missing = []
        this.plays = []
    }
}
