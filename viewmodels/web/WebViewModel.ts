export interface TrackRow {
    name: string
    chosen: boolean
}

export interface ViewActions {
    playOrStop: () => void
    append: (files: File[]) => void
    remove: () => void
    randomize: () => void
}

export interface ViewState {
    names: string[]
    index: number
    playing: boolean
}

// What the widget shows, and the actions its controls send. No audio code.
export class WebViewModel {
    tracks: TrackRow[] = []
    playing = false
    error = ''

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

    get playLabel(): string {
        return this.playing ? 'Stop' : 'Play'
    }

    playOrStop() {
        this.actions?.playOrStop()
    }

    append(files: File[]) {
        if (files.length > 0) {
            this.actions?.append(files)
        }
    }

    remove() {
        this.actions?.remove()
    }

    randomize() {
        this.actions?.randomize()
    }

    show(state: ViewState) {
        const tracks = state.names.map((name, i) => ({ name, chosen: i === state.index }))
        const sameTracks =
            tracks.length === this.tracks.length &&
            tracks.every((track, i) => track.name === this.tracks[i].name && track.chosen === this.tracks[i].chosen)
        if (sameTracks && this.playing === state.playing) {
            return
        }
        this.tracks = tracks
        this.playing = state.playing
        this.error = ''
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
