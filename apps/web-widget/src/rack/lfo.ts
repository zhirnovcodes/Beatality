import type { ParameterInfo, PluginEvent, PluginFactory, PluginInstance } from '../../../../hosts/web/plugin'

// A test source for the rack: no audio, one value swinging 0..1, sent as automation on 'out'.

const shapes = ['Sine', 'Triangle', 'Saw', 'Square']
const rateMin = 0.05
const rateMax = 8
// About one value per screen frame.
const sendMs = 16

const info: ParameterInfo[] = [
    { id: 'rate', label: 'Rate (Hz)', kind: 'float', min: rateMin, max: rateMax },
    { id: 'shape', label: 'Shape', kind: 'int', min: 0, max: shapes.length - 1 },
]

// phase is 0..1.
function wave(shape: number, phase: number): number {
    if (shape === 0) {
        return 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
    }
    if (shape === 1) {
        return phase < 0.5 ? phase * 2 : 2 - phase * 2
    }
    if (shape === 2) {
        return phase
    }
    return phase < 0.5 ? 1 : 0
}

export const lfo: PluginFactory = {
    name: 'LFO',

    async create(context: AudioContext, container: HTMLElement): Promise<PluginInstance> {
        let rate = 0.5
        let shape = 0
        let phase = 0
        let last = performance.now()
        const listeners = new Set<(event: PluginEvent) => void>()
        const watchers = new Set<(id: string, value: number) => void>()

        const root = document.createElement('div')
        root.className = 'lfo'
        root.innerHTML = `
            <label>Rate <input type="range" class="rate" min="${rateMin}" max="${rateMax}" step="0.01"> <output class="rate-value"></output></label>
            <label>Shape <select class="shape">${shapes.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label>
            <div class="meter"><div class="fill"></div></div>`
        container.append(root)
        const rateInput = root.querySelector<HTMLInputElement>('.rate')!
        const rateValue = root.querySelector<HTMLOutputElement>('.rate-value')!
        const shapeSelect = root.querySelector<HTMLSelectElement>('.shape')!
        const fill = root.querySelector<HTMLElement>('.fill')!

        const normalized = (id: string): number => {
            if (id === 'rate') {
                return (rate - rateMin) / (rateMax - rateMin)
            }
            if (id === 'shape') {
                return shape / (shapes.length - 1)
            }
            return 0
        }
        const show = () => {
            rateInput.value = String(rate)
            rateValue.value = rate.toFixed(2)
            shapeSelect.value = String(shape)
        }
        const changed = (id: string) => {
            show()
            for (const watcher of watchers) {
                watcher(id, normalized(id))
            }
        }
        show()

        rateInput.addEventListener('input', () => {
            rate = rateInput.valueAsNumber
            changed('rate')
        })
        shapeSelect.addEventListener('change', () => {
            shape = Number(shapeSelect.value)
            changed('shape')
        })

        const timer = window.setInterval(() => {
            const now = performance.now()
            phase = (phase + ((now - last) / 1000) * rate) % 1
            last = now
            const value = wave(shape, phase)
            fill.style.width = `${value * 100}%`
            const event: PluginEvent = { type: 'automation', time: context.currentTime, id: 'out', value }
            for (const listener of listeners) {
                listener(event)
            }
        }, sendMs)

        return {
            audioInput: null,
            audioOutput: null,
            parameters: () => info,
            parameter: normalized,
            schedule: (events) => {
                for (const event of events) {
                    if (event.type !== 'automation') {
                        continue
                    }
                    const unit = Math.min(1, Math.max(0, event.value))
                    if (event.id === 'rate') {
                        rate = rateMin + unit * (rateMax - rateMin)
                        changed('rate')
                    } else if (event.id === 'shape') {
                        shape = Math.round(unit * (shapes.length - 1))
                        changed('shape')
                    }
                }
            },
            listen: (listener) => {
                listeners.add(listener)
                return () => {
                    listeners.delete(listener)
                }
            },
            subscribe: (watcher) => {
                watchers.add(watcher)
                return () => {
                    watchers.delete(watcher)
                }
            },
            // Its controls take no drops yet.
            onDrop: () => () => {},
            dispose: () => {
                window.clearInterval(timer)
                listeners.clear()
                watchers.clear()
                root.remove()
            },
        }
    },
}
