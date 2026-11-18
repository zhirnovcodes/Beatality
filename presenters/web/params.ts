import paramsJson from '../../params.json'
import type { ParameterInfo as V1ParameterInfo } from '../../hosts/web/plugin'

// Beatality's host parameters, from params.json at the repo root. The JUCE build reads the same file.
// Order, ids, and ranges are what DAWs store automation by.
export interface ParamSpec {
    id: string
    label: string
    // trigger fires on a rise past 0.5 and reads back 0. choice is an index into choices.
    kind: 'float' | 'int' | 'boolean' | 'trigger' | 'choice'
    min: number
    max: number
    default: number
    group: string
    unit?: string
    choices?: string[]
    automatable: boolean
}

export const params: ParamSpec[] = paramsJson.params as ParamSpec[]

const byId = new Map(params.map((param) => [param.id, param]))

// Throws on an id params.json lacks: a typo in our own code.
export function paramSpec(id: string): ParamSpec {
    const param = byId.get(id)
    if (!param) {
        throw new Error(`params.json has no parameter ${id}`)
    }
    return param
}

// The v1 API (the rack page) knows only float, int, and boolean. A trigger is a boolean; a choice is an int index.
export function infoFor(id: string): V1ParameterInfo {
    const { label, kind, min, max } = paramSpec(id)
    return {
        id,
        label,
        kind: kind === 'trigger' ? 'boolean' : kind === 'choice' ? 'int' : kind,
        min,
        max,
    }
}
