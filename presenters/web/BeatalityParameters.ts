import type { ParameterInfo } from '../../hosts/web/plugin'
import type { WebViewModel } from '../../viewmodels/web/WebViewModel'

interface Entry {
    info: ParameterInfo
    // In min..max.
    read: () => number
    write: (value: number) => void
}

type Listener = (id: string, value: number) => void

// The controls a wrapper can drive. Values cross this boundary as 0..1.
// Each write goes through the same model setter the control on the page uses.
export class BeatalityParameters {
    private readonly entries: Entry[]
    private readonly listeners = new Set<Listener>()
    // The last value reported for each id.
    private readonly sent = new Map<string, number>()
    private stopModel: (() => void) | null = null
    private randomizeHeld = 0

    constructor(private readonly model: WebViewModel) {
        this.entries = [
            {
                info: { id: 'loop', label: 'Loop', kind: 'int', min: 1, max: 32 },
                read: () => model.loopBeats,
                write: (beats) => model.setLoop(beats),
            },
            {
                // The model keeps the slice no longer than the loop.
                info: { id: 'slice', label: 'Slices', kind: 'int', min: -4, max: 4 },
                read: () => model.sliceExp,
                write: (exponent) => model.setSlice(exponent),
            },
            {
                // Randomizes once each time the value rises past 0.5.
                info: { id: 'randomize', label: 'Randomize', kind: 'boolean', min: 0, max: 1 },
                read: () => this.randomizeHeld,
                write: (value) => {
                    const held = value > 0.5 ? 1 : 0
                    if (held === 1 && this.randomizeHeld === 0) {
                        model.randomize()
                    }
                    this.randomizeHeld = held
                },
            },
            {
                info: { id: 'volume', label: 'Volume', kind: 'float', min: 0, max: 1.2 },
                read: () => model.outputVolume,
                write: (volume) => model.setOutput(volume, model.outputPanMin, model.outputPanMax),
            },
            {
                info: { id: 'panMin', label: 'Pan minimum', kind: 'float', min: -1, max: 1 },
                read: () => model.outputPanMin,
                write: (pan) => model.setOutputPanMin(pan),
            },
            {
                info: { id: 'panMax', label: 'Pan maximum', kind: 'float', min: -1, max: 1 },
                read: () => model.outputPanMax,
                write: (pan) => model.setOutputPanMax(pan),
            },
        ]
    }

    info(): ParameterInfo[] {
        return this.entries.map((entry) => entry.info)
    }

    value(id: string): number {
        const entry = this.find(id)
        return entry ? this.normalized(entry) : 0
    }

    set(id: string, value: number) {
        const entry = this.find(id)
        if (!entry || !Number.isFinite(value)) {
            return
        }
        const { kind, min, max } = entry.info
        const scaled = min + Math.min(1, Math.max(0, value)) * (max - min)
        entry.write(kind === 'float' ? scaled : Math.round(scaled))
        // Randomize holds no model state, so the model does not report it.
        if (kind === 'boolean') {
            this.report()
        }
    }

    // Reports only the parameters whose value changed.
    subscribe(listener: Listener): () => void {
        if (this.listeners.size === 0) {
            for (const entry of this.entries) {
                this.sent.set(entry.info.id, this.normalized(entry))
            }
            this.stopModel = this.model.subscribe(() => this.report())
        }
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
            if (this.listeners.size === 0) {
                this.stopModel?.()
                this.stopModel = null
            }
        }
    }

    private report() {
        for (const entry of this.entries) {
            const value = this.normalized(entry)
            if (this.sent.get(entry.info.id) === value) {
                continue
            }
            this.sent.set(entry.info.id, value)
            for (const listener of this.listeners) {
                listener(entry.info.id, value)
            }
        }
    }

    private find(id: string): Entry | undefined {
        return this.entries.find((entry) => entry.info.id === id)
    }

    private normalized(entry: Entry): number {
        const { min, max } = entry.info
        return (entry.read() - min) / (max - min)
    }
}
