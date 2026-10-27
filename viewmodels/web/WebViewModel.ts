export interface TrackRow {
    name: string
}

export interface ViewActions {
    midi: (status: number, note: number, velocity: number) => void
    loadPack: () => Promise<void>
    append: (files: File[]) => void
    remove: (index: number) => void
    clear: () => void
    randomize: () => void
    setBpm: (bpm: number) => void
    setLoop: (beats: number) => void
    setSlice: (exponent: number) => void
    setAttack: (ms: number) => void
}

export interface ViewState {
    names: string[]
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

function sliceBeats(exponent: number): number {
    return 2 ** exponent
}

function unit(value: number): number {
    if (!(value >= 0)) {
        return 0
    }
    return value > 1 ? 1 : value
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
    loopBeats = 8
    sliceExp = 0
    attackMs = 2

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

    loadPack(): Promise<void> {
        return this.actions?.loadPack() ?? Promise.resolve()
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

    setBpm(bpm: number) {
        if (!(bpm > 0) || !Number.isFinite(bpm)) {
            return
        }
        if (bpm === this.bpm) {
            return
        }
        this.bpm = bpm
        this.notify()
        this.actions?.setBpm(bpm)
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

    show(state: ViewState) {
        const tracks = state.names.map((name) => ({ name }))
        const sliceExp = fitSlice(state.sliceExp ?? this.sliceExp, this.loopBeats)
        const playhead = unit(state.playhead)
        const sameTracks =
            tracks.length === this.tracks.length && tracks.every((track, i) => track.name === this.tracks[i].name)
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
