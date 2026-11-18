import type { ParameterInfo as V1ParameterInfo } from '../../../hosts/web/plugin'
import type { ParameterChange, ParameterInfo } from '../../../hosts/web/plugin-v2'
import { paramSpec } from '../../../presenters/web/params'

// The v2 view of Beatality's parameters. BeatalityParameters stays on the v1 API for the rack page;
// this file adds what v2 asks for on top of it. Kind, group, unit, and choices come from params.json.

// Fires on a rise past 0.5 and always reads back 0.
export function isTrigger(id: string): boolean {
    return paramSpec(id).kind === 'trigger'
}

export function groupFor(id: string): string {
    return paramSpec(id).group
}

// normalizedDefault is the parameter's 0..1 value with the default pack loaded.
export function dawParameter(info: V1ParameterInfo, normalizedDefault: number): ParameterInfo {
    const spec = paramSpec(info.id)
    const trigger = spec.kind === 'trigger'
    const result: ParameterInfo = {
        id: info.id,
        label: info.label,
        kind: spec.kind,
        min: info.min,
        max: info.max,
        default: trigger ? info.min : denormalize(info, normalizedDefault),
        group: spec.group,
        automatable: spec.automatable,
    }
    if (spec.choices) {
        result.choices = [...spec.choices]
    }
    if (spec.unit) {
        result.unit = spec.unit
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
