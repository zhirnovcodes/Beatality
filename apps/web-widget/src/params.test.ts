import { describe, expect, it, vi } from 'vitest'
import { BeatalityParameters } from '../../../presenters/web/BeatalityParameters'
import { params } from '../../../presenters/web/params'
import { WebViewModel } from '../../../viewmodels/web/WebViewModel'
import { dawParameter, groupFor, isTrigger } from './dawParameters'

// params.json is the one parameter list. The JUCE build checks it against the core in params_tests.

describe('params.json', () => {
    it('has unique ids', () => {
        const ids = params.map((param) => param.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('has well-formed ranges, defaults, and choices', () => {
        for (const param of params) {
            expect(param.min, param.id).toBeLessThan(param.max)
            expect(param.default, param.id).toBeGreaterThanOrEqual(param.min)
            expect(param.default, param.id).toBeLessThanOrEqual(param.max)
            if (param.kind === 'choice') {
                expect(param.choices?.length, param.id).toBe(param.max - param.min + 1)
            } else {
                expect(param.choices, param.id).toBeUndefined()
            }
        }
    })
})

describe('BeatalityParameters', () => {
    const model = new WebViewModel()
    const parameters = new BeatalityParameters(model)
    const infos = parameters.info()

    it('has exactly one entry per params.json id, in params.json order', () => {
        expect(infos.map((info) => info.id)).toEqual(params.map((param) => param.id))
    })

    it('takes label and range from params.json', () => {
        for (const [index, param] of params.entries()) {
            const info = infos[index]
            expect({ label: info.label, min: info.min, max: info.max }, param.id).toEqual({
                label: param.label,
                min: param.min,
                max: param.max,
            })
        }
    })

    it('fires CHAOS once per rise past 0.5', () => {
        const chaos = vi.spyOn(model, 'chaos').mockImplementation(() => {})
        parameters.set('chaos', 1)
        parameters.set('chaos', 1)
        parameters.set('chaos', 0)
        parameters.set('chaos', 1)
        expect(chaos).toHaveBeenCalledTimes(2)
        expect(parameters.value('chaos')).toBe(1)
        parameters.set('chaos', 0)
        chaos.mockRestore()
    })
})

describe('dawParameter', () => {
    const parameters = new BeatalityParameters(new WebViewModel())

    it('matches params.json for every id', () => {
        for (const info of parameters.info()) {
            const param = params.find((p) => p.id === info.id)!
            const v2 = dawParameter(info, 0)
            expect(
                { kind: v2.kind, group: v2.group, unit: v2.unit, choices: v2.choices, min: v2.min, max: v2.max },
                info.id,
            ).toEqual({
                kind: param.kind,
                group: param.group,
                unit: param.unit,
                choices: param.choices,
                min: param.min,
                max: param.max,
            })
            expect(isTrigger(info.id), info.id).toBe(param.kind === 'trigger')
            expect(groupFor(info.id), info.id).toBe(param.group)
        }
    })
})
