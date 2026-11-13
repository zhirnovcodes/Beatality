import { chaosTriggerNames } from '../../../hosts/web/pack'
import type { ParameterInfo as V1ParameterInfo } from '../../../hosts/web/plugin'
import type { ParameterChange, ParameterInfo } from '../../../hosts/web/plugin-v2'

// The v2 view of Beatality's parameters. BeatalityParameters stays on the v1 API for the rack page;
// this file adds what v2 asks for on top of it.

// Fire on a rise past 0.5 and always read back 0.
const triggers = new Set(['randomize', 'shuffle'])

const groups: [string, string[]][] = [
    ['Output', ['volume', 'panMin', 'panMax']],
    ['Loop', ['loop', 'slice', 'retrig', 'randomize']],
    [
        'Effects',
        [
            'effectsOn', 'shuffle', 'globalPower', 'globalChance', 'fxTimeMin', 'fxTimeMax',
            'delayPower', 'delayChance', 'reverbPower', 'reverbChance', 'reversePower', 'reverseChance',
            'filterPower', 'filterChance', 'flangerPower', 'flangerChance', 'trancePower', 'tranceChance',
            'shiftPower', 'shiftChance',
        ],
    ],
    ['Repeat', ['repeatOn', 'repeatSizeMin', 'repeatSizeMax', 'repeatMix', 'repeatLength', 'repeatChance']],
]
const groupOf = new Map(groups.flatMap(([group, ids]) => ids.map((id) => [id, group] as const)))

const units: Record<string, string> = { loop: 'beats' }

export function isTrigger(id: string): boolean {
    return triggers.has(id)
}

// The group a parameter belongs to. Every chaos parameter starts with "chaos".
export function groupFor(id: string): string | undefined {
    return groupOf.get(id) ?? (id.startsWith('chaos') ? 'Chaos' : undefined)
}

// normalizedDefault is the parameter's 0..1 value with the default pack loaded.
export function dawParameter(info: V1ParameterInfo, normalizedDefault: number): ParameterInfo {
    const trigger = isTrigger(info.id)
    const result: ParameterInfo = {
        id: info.id,
        label: info.label,
        kind: trigger ? 'trigger' : info.id === 'chaosTrigger' ? 'choice' : info.kind,
        min: info.min,
        max: info.max,
        default: trigger ? info.min : denormalize(info, normalizedDefault),
        automatable: true,
    }
    if (info.id === 'chaosTrigger') {
        result.choices = [...chaosTriggerNames]
    }
    const group = groupFor(info.id)
    if (group) {
        result.group = group
    }
    const unit = units[info.id]
    if (unit) {
        result.unit = unit
    }
    return result
}

// 0..1 to min..max. Whole-numbered kinds round, as BeatalityParameters.set does.
export function denormalize(info: V1ParameterInfo, value: number): number {
    const scaled = info.min + Math.min(1, Math.max(0, value)) * (info.max - info.min)
    return info.kind === 'float' ? scaled : Math.round(scaled)
}

// Tags each reported change with who caused it. The view model reports synchronously,
// so a change seen while a host write runs belongs to that write; any other is the widget's.
export class ChangeSources {
    private current: ParameterChange['source'] = 'ui'

    during(source: ParameterChange['source'], write: () => void) {
        const before = this.current
        this.current = source
        try {
            write()
        } finally {
            this.current = before
        }
    }

    // For a load that awaits: every change until it settles is the given source's.
    async duringLoad(source: ParameterChange['source'], load: () => Promise<void>) {
        const before = this.current
        this.current = source
        try {
            await load()
        } finally {
            this.current = before
        }
    }

    change(id: string, value: number): ParameterChange | null {
        // A trigger reads back 0, so its edge is not a change worth reporting.
        if (isTrigger(id)) {
            return null
        }
        return { id, value, source: this.current }
    }
}
