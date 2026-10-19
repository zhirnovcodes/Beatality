// File names in list order, and the ids the audio thread uses to free buffers.
export class TrackRegistry {
    static readonly capacity = 32

    private names: string[] = []
    private nextId = 1

    get count(): number {
        return this.names.length
    }

    list(): string[] {
        return this.names.slice()
    }

    // Null when the list is full. Ids start at 1 and are never reused.
    add(name: string): number | null {
        if (this.names.length >= TrackRegistry.capacity) {
            return null
        }
        this.names.push(name)
        return this.nextId++
    }

    removeAt(index: number): void {
        this.names.splice(index, 1)
    }
}
