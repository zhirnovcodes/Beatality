import type { ParameterInfo } from '../../hosts/web/plugin'
import type { WebViewModel } from '../../viewmodels/web/WebViewModel'
import { infoFor, params } from './params'

// The chaos group toggles: the boolean parameters in the Chaos group, in params.json order, which is chaos group order.
const chaosGroupIds = params.filter((param) => param.group === 'Chaos' && param.kind === 'boolean').map((param) => param.id)

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
    private chaosHeld = 0
    private shuffleHeld = 0

    constructor(private readonly model: WebViewModel) {
        this.entries = [
            {
                info: infoFor('loop'),
                read: () => model.loopBeats,
                write: (beats) => model.setLoop(beats),
            },
            {
                // The model keeps the slice no longer than the loop.
                info: infoFor('slice'),
                read: () => model.sliceExp,
                write: (exponent) => model.setSlice(exponent),
            },
            {
                // Randomizes once each time the value rises past 0.5.
                info: infoFor('randomize'),
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
                // Presses CHAOS once each time the value rises past 0.5.
                info: infoFor('chaos'),
                read: () => this.chaosHeld,
                write: (value) => {
                    const held = value > 0.5 ? 1 : 0
                    if (held === 1 && this.chaosHeld === 0) {
                        model.chaos()
                    }
                    this.chaosHeld = held
                },
            },
            {
                info: infoFor('volume'),
                read: () => model.outputVolume,
                write: (volume) => model.setOutput(volume, model.outputPanMin, model.outputPanMax),
            },
            {
                info: infoFor('panMin'),
                read: () => model.outputPanMin,
                write: (pan) => model.setOutputPanMin(pan),
            },
            {
                info: infoFor('panMax'),
                read: () => model.outputPanMax,
                write: (pan) => model.setOutputPanMax(pan),
            },
            {
                info: infoFor('effectsOn'),
                read: () => (model.effectsEnabled ? 1 : 0),
                write: (on) => model.setEffectsEnabled(on > 0.5),
            },
            {
                // Presses Shuffle once each time the value rises past 0.5.
                info: infoFor('shuffle'),
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
                info: infoFor('globalPower'),
                read: () => model.globalPower,
                write: (value) => model.setGlobalPower(value),
            },
            {
                info: infoFor('globalChance'),
                read: () => model.globalChance,
                write: (value) => model.setGlobalChance(value),
            },
            {
                // The model keeps min no higher than max.
                info: infoFor('fxTimeMin'),
                read: () => model.globalBeatMinExp,
                write: (exponent) => model.setGlobalBeatMin(exponent),
            },
            {
                info: infoFor('fxTimeMax'),
                read: () => model.globalBeatMaxExp,
                write: (exponent) => model.setGlobalBeatMax(exponent),
            },
            {
                info: infoFor('delayPower'),
                read: () => model.delayPower,
                write: (value) => model.setDelayPower(value),
            },
            {
                info: infoFor('delayChance'),
                read: () => model.delayChance,
                write: (value) => model.setDelayChance(value),
            },
            {
                info: infoFor('reverbPower'),
                read: () => model.reverbPower,
                write: (value) => model.setReverbPower(value),
            },
            {
                info: infoFor('reverbChance'),
                read: () => model.reverbChance,
                write: (value) => model.setReverbChance(value),
            },
            {
                info: infoFor('reversePower'),
                read: () => model.reversePower,
                write: (value) => model.setReversePower(value),
            },
            {
                info: infoFor('reverseChance'),
                read: () => model.reverseChance,
                write: (value) => model.setReverseChance(value),
            },
            {
                info: infoFor('filterPower'),
                read: () => model.filterPower,
                write: (value) => model.setFilterPower(value),
            },
            {
                info: infoFor('filterChance'),
                read: () => model.filterChance,
                write: (value) => model.setFilterChance(value),
            },
            {
                info: infoFor('flangerPower'),
                read: () => model.flangerPower,
                write: (value) => model.setFlangerPower(value),
            },
            {
                info: infoFor('flangerChance'),
                read: () => model.flangerChance,
                write: (value) => model.setFlangerChance(value),
            },
            {
                info: infoFor('trancePower'),
                read: () => model.trancePower,
                write: (value) => model.setTrancePower(value),
            },
            {
                info: infoFor('tranceChance'),
                read: () => model.tranceChance,
                write: (value) => model.setTranceChance(value),
            },
            {
                info: infoFor('shiftPower'),
                read: () => model.shiftPower,
                write: (value) => model.setShiftPower(value),
            },
            {
                info: infoFor('shiftChance'),
                read: () => model.shiftChance,
                write: (value) => model.setShiftChance(value),
            },
            {
                info: infoFor('repeatOn'),
                read: () => (model.repeatEnabled ? 1 : 0),
                write: (on) => model.setRepeatEnabled(on > 0.5),
            },
            {
                // The model keeps min no higher than max.
                info: infoFor('repeatSizeMin'),
                read: () => model.repeatSizeMinExp,
                write: (exponent) => model.setRepeatSizeMin(exponent),
            },
            {
                info: infoFor('repeatSizeMax'),
                read: () => model.repeatSizeMaxExp,
                write: (exponent) => model.setRepeatSizeMax(exponent),
            },
            {
                info: infoFor('repeatMix'),
                read: () => model.repeatMix,
                write: (value) => model.setRepeatMix(value),
            },
            {
                info: infoFor('repeatLength'),
                read: () => model.repeatLengthExp,
                write: (exponent) => model.setRepeatLength(exponent),
            },
            {
                info: infoFor('repeatChance'),
                read: () => model.repeatChance,
                write: (value) => model.setRepeatChance(value),
            },
            {
                // 0 Note, 1 Loop, 2 Slices, 3 Beats, 4 None.
                info: infoFor('chaosTrigger'),
                read: () => model.chaosTrigger,
                write: (trigger) => model.setChaosTrigger(trigger),
            },
            {
                info: infoFor('chaosValue'),
                read: () => model.chaosValue,
                write: (value) => model.setChaosValue(value),
            },
            {
                info: infoFor('chaosBeatSize'),
                read: () => model.chaosBeatSize,
                write: (exponent) => model.setChaosBeatSize(exponent),
            },
            {
                info: infoFor('chaosLoopSize'),
                read: () => model.chaosLoopSize,
                write: (loops) => model.setChaosLoopSize(loops),
            },
            {
                info: infoFor('chaosSliceSize'),
                read: () => model.chaosSliceSize,
                write: (exponent) => model.setChaosSliceSize(exponent),
            },
            ...chaosGroupIds.map((id, group) => ({
                info: infoFor(id),
                read: () => (model.chaosGroups[group] ? 1 : 0),
                write: (on: number) => model.setChaosGroup(group, on > 0.5),
            })),
            {
                info: infoFor('retrig'),
                read: () => (model.retrig ? 1 : 0),
                write: (on) => model.setRetrig(on > 0.5),
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
        // Randomize, Chaos, and Shuffle hold no model state, so the model does not report them.
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
