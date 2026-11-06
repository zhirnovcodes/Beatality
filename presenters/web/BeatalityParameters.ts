import type { ParameterInfo } from '../../hosts/web/plugin'
import { chaosGroupNames, type WebViewModel } from '../../viewmodels/web/WebViewModel'

// The same ids as the plugin's host parameters, in chaos group order.
const chaosGroupIds = [
    'chaosPan',
    'chaosSlices',
    'chaosRandomize',
    'chaosEffectsGlobal',
    'chaosEffectsOn',
    'chaosEffectsPrivate',
    'chaosRepeatOn',
    'chaosRepeatPositions',
    'chaosRepeatParams',
    'chaosValueOn',
    'chaosTime',
]

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
    private shuffleHeld = 0

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
            {
                info: { id: 'effectsOn', label: 'Effects on', kind: 'boolean', min: 0, max: 1 },
                read: () => (model.effectsEnabled ? 1 : 0),
                write: (on) => model.setEffectsEnabled(on > 0.5),
            },
            {
                // Presses Shuffle once each time the value rises past 0.5.
                info: { id: 'shuffle', label: 'Shuffle', kind: 'boolean', min: 0, max: 1 },
                read: () => this.shuffleHeld,
                write: (value) => {
                    const held = value > 0.5 ? 1 : 0
                    if (held === 1 && this.shuffleHeld === 0) {
                        model.shuffleEffects()
                    }
                    this.shuffleHeld = held
                },
            },
            {
                info: { id: 'globalPower', label: 'Global power', kind: 'float', min: 0, max: 1 },
                read: () => model.globalPower,
                write: (value) => model.setGlobalPower(value),
            },
            {
                info: { id: 'globalChance', label: 'Global chance', kind: 'float', min: 0, max: 1 },
                read: () => model.globalChance,
                write: (value) => model.setGlobalChance(value),
            },
            {
                // The model keeps min no higher than max.
                info: { id: 'fxTimeMin', label: 'Effect time minimum', kind: 'int', min: -4, max: 1 },
                read: () => model.globalBeatMinExp,
                write: (exponent) => model.setGlobalBeatMin(exponent),
            },
            {
                info: { id: 'fxTimeMax', label: 'Effect time maximum', kind: 'int', min: -4, max: 1 },
                read: () => model.globalBeatMaxExp,
                write: (exponent) => model.setGlobalBeatMax(exponent),
            },
            {
                info: { id: 'delayPower', label: 'Delay power', kind: 'float', min: 0, max: 1 },
                read: () => model.delayPower,
                write: (value) => model.setDelayPower(value),
            },
            {
                info: { id: 'delayChance', label: 'Delay chance', kind: 'float', min: 0, max: 1 },
                read: () => model.delayChance,
                write: (value) => model.setDelayChance(value),
            },
            {
                info: { id: 'reverbPower', label: 'Reverb power', kind: 'float', min: 0, max: 1 },
                read: () => model.reverbPower,
                write: (value) => model.setReverbPower(value),
            },
            {
                info: { id: 'reverbChance', label: 'Reverb chance', kind: 'float', min: 0, max: 1 },
                read: () => model.reverbChance,
                write: (value) => model.setReverbChance(value),
            },
            {
                info: { id: 'reversePower', label: 'Reverse power', kind: 'float', min: 0, max: 1 },
                read: () => model.reversePower,
                write: (value) => model.setReversePower(value),
            },
            {
                info: { id: 'reverseChance', label: 'Reverse chance', kind: 'float', min: 0, max: 1 },
                read: () => model.reverseChance,
                write: (value) => model.setReverseChance(value),
            },
            {
                info: { id: 'filterPower', label: 'Filter power', kind: 'float', min: 0, max: 1 },
                read: () => model.filterPower,
                write: (value) => model.setFilterPower(value),
            },
            {
                info: { id: 'filterChance', label: 'Filter chance', kind: 'float', min: 0, max: 1 },
                read: () => model.filterChance,
                write: (value) => model.setFilterChance(value),
            },
            {
                info: { id: 'flangerPower', label: 'Flanger power', kind: 'float', min: 0, max: 1 },
                read: () => model.flangerPower,
                write: (value) => model.setFlangerPower(value),
            },
            {
                info: { id: 'flangerChance', label: 'Flanger chance', kind: 'float', min: 0, max: 1 },
                read: () => model.flangerChance,
                write: (value) => model.setFlangerChance(value),
            },
            {
                info: { id: 'trancePower', label: 'Trance power', kind: 'float', min: 0, max: 1 },
                read: () => model.trancePower,
                write: (value) => model.setTrancePower(value),
            },
            {
                info: { id: 'tranceChance', label: 'Trance chance', kind: 'float', min: 0, max: 1 },
                read: () => model.tranceChance,
                write: (value) => model.setTranceChance(value),
            },
            {
                info: { id: 'shiftPower', label: 'Shift power', kind: 'float', min: 0, max: 1 },
                read: () => model.shiftPower,
                write: (value) => model.setShiftPower(value),
            },
            {
                info: { id: 'shiftChance', label: 'Shift chance', kind: 'float', min: 0, max: 1 },
                read: () => model.shiftChance,
                write: (value) => model.setShiftChance(value),
            },
            {
                info: { id: 'repeatOn', label: 'Beat repeat on', kind: 'boolean', min: 0, max: 1 },
                read: () => (model.repeatEnabled ? 1 : 0),
                write: (on) => model.setRepeatEnabled(on > 0.5),
            },
            {
                // The model keeps min no higher than max.
                info: { id: 'repeatSizeMin', label: 'Size minimum', kind: 'int', min: -5, max: 1 },
                read: () => model.repeatSizeMinExp,
                write: (exponent) => model.setRepeatSizeMin(exponent),
            },
            {
                info: { id: 'repeatSizeMax', label: 'Size maximum', kind: 'int', min: -5, max: 1 },
                read: () => model.repeatSizeMaxExp,
                write: (exponent) => model.setRepeatSizeMax(exponent),
            },
            {
                info: { id: 'repeatMix', label: 'Mix', kind: 'float', min: 0, max: 1 },
                read: () => model.repeatMix,
                write: (value) => model.setRepeatMix(value),
            },
            {
                info: { id: 'repeatLength', label: 'Length', kind: 'int', min: -4, max: 1 },
                read: () => model.repeatLengthExp,
                write: (exponent) => model.setRepeatLength(exponent),
            },
            {
                info: { id: 'repeatChance', label: 'Chance', kind: 'float', min: 0, max: 1 },
                read: () => model.repeatChance,
                write: (value) => model.setRepeatChance(value),
            },
            {
                // 0 Randomize button, 1 Note, 2 Loop, 3 Slices, 4 Beats.
                info: { id: 'chaosTrigger', label: 'Chaos trigger', kind: 'int', min: 0, max: 4 },
                read: () => model.chaosTrigger,
                write: (trigger) => model.setChaosTrigger(trigger),
            },
            {
                info: { id: 'chaosValue', label: 'Chaos value', kind: 'float', min: 0, max: 1 },
                read: () => model.chaosValue,
                write: (value) => model.setChaosValue(value),
            },
            {
                info: { id: 'chaosBeatSize', label: 'Chaos beat size', kind: 'int', min: -2, max: 1 },
                read: () => model.chaosBeatSize,
                write: (exponent) => model.setChaosBeatSize(exponent),
            },
            {
                info: { id: 'chaosLoopSize', label: 'Chaos loop size', kind: 'int', min: 1, max: 8 },
                read: () => model.chaosLoopSize,
                write: (loops) => model.setChaosLoopSize(loops),
            },
            {
                info: { id: 'chaosSliceSize', label: 'Chaos slice size', kind: 'int', min: -1, max: 2 },
                read: () => model.chaosSliceSize,
                write: (exponent) => model.setChaosSliceSize(exponent),
            },
            ...chaosGroupIds.map((id, group) => ({
                info: { id, label: `Chaos ${chaosGroupNames[group].toLowerCase()}`, kind: 'boolean' as const, min: 0, max: 1 },
                read: () => (model.chaosGroups[group] ? 1 : 0),
                write: (on: number) => model.setChaosGroup(group, on > 0.5),
            })),
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
        // Randomize and Shuffle hold no model state, so the model does not report them.
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
