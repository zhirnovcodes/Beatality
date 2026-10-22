export interface TrackWave {
    samples: Float32Array
    sampleRate: number
}

// File names in list order, the waveform the page draws, and the ids the audio thread uses.
export class TrackRegistry {
    static readonly capacity = 32

    private names: string[] = []
    private waves: TrackWave[] = []
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

    // Null when the list is full. Ids start at 1 and are never reused.
    add(name: string, wave: TrackWave): number | null {
        if (this.names.length >= TrackRegistry.capacity) {
            return null
        }
        this.names.push(name)
        this.waves.push(wave)
        return this.nextId++
    }

    removeAt(index: number): void {
        this.names.splice(index, 1)
        this.waves.splice(index, 1)
    }
}
