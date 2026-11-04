import { sourceDragType, type PluginEvent, type PluginFactory, type PluginInstance } from '../../../../hosts/web/plugin'
import { beatality } from '../plugin'
import { lfo } from './lfo'
import './rack.css'

// Test wrapper. It owns the context, the windows, and every route between plugins.
// A binding sends one plugin's automation events to another plugin's parameter.

interface Kind {
    factory: PluginFactory
    // Its window gets a handle to drag onto another plugin's control.
    emits: boolean
}

interface Slot {
    id: string
    title: string
    instance: PluginInstance
    frame: HTMLElement
    bindings: HTMLUListElement
    stops: (() => void)[]
}

interface Binding {
    from: Slot
    to: Slot
    parameter: string
}

const kinds: Kind[] = [
    { factory: beatality, emits: false },
    { factory: lfo, emits: true },
]

const context = new AudioContext()
const slots = new Map<string, Slot>()
let bindings: Binding[] = []
const counts = new Map<string, number>()
let nextId = 1
let nextZ = 1
let playing = false
let bpm = 120

const desk = document.querySelector<HTMLElement>('#desk')!
const toolbar = document.querySelector<HTMLElement>('#toolbar')!
const play = document.querySelector<HTMLButtonElement>('#play')!
const tempoInput = document.querySelector<HTMLInputElement>('#tempo')!

// Browsers start audio only after a gesture. Any click on the page counts.
document.addEventListener('pointerdown', () => void context.resume())

const sendAll = (event: PluginEvent) => {
    for (const slot of slots.values()) {
        slot.instance.schedule([event])
    }
}

async function add(kind: Kind) {
    const count = (counts.get(kind.factory.name) ?? 0) + 1
    counts.set(kind.factory.name, count)
    const id = `p${nextId++}`
    const title = `${kind.factory.name} ${count}`

    const frame = document.createElement('section')
    frame.className = 'rack-window'
    // Side by side, three to a row. A Beatality window is 496px wide.
    const place = desk.childElementCount
    frame.style.left = `${24 + (place % 3) * 536}px`
    frame.style.top = `${24 + Math.floor(place / 3) * 80}px`
    frame.style.zIndex = String(nextZ++)
    const bar = document.createElement('header')
    bar.className = 'rack-bar'
    const name = document.createElement('span')
    name.className = 'rack-title'
    name.textContent = title
    bar.append(name)
    if (kind.emits) {
        const handle = document.createElement('span')
        handle.className = 'rack-source'
        handle.draggable = true
        handle.textContent = 'drag onto a control'
        handle.addEventListener('dragstart', (event) => {
            event.dataTransfer?.setData(sourceDragType, id)
        })
        bar.append(handle)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'rack-close'
    close.setAttribute('aria-label', `Close ${title}`)
    close.textContent = '×'
    bar.append(close)
    const list = document.createElement('ul')
    list.className = 'rack-bindings'
    const body = document.createElement('div')
    body.className = 'rack-body'
    frame.append(bar, list, body)
    desk.append(frame)
    moveWith(bar, frame)

    const instance = await kind.factory.create(context, body)
    instance.audioOutput?.connect(context.destination)
    instance.schedule([{ type: 'tempo', time: context.currentTime, bpm }])
    const slot: Slot = { id, title, instance, frame, bindings: list, stops: [] }
    slots.set(id, slot)
    slot.stops.push(
        instance.listen((event) => route(slot, event)),
        instance.onDrop((source, parameter) => {
            const from = slots.get(source)
            if (from && from !== slot) {
                bind(from, slot, parameter)
            }
        }),
    )
    close.addEventListener('click', () => remove(slot))
}

function route(from: Slot, event: PluginEvent) {
    if (event.type !== 'automation') {
        return
    }
    for (const binding of bindings) {
        if (binding.from === from) {
            binding.to.instance.schedule([{ ...event, id: binding.parameter }])
        }
    }
}

// One source per parameter. A new one replaces the old.
function bind(from: Slot, to: Slot, parameter: string) {
    bindings = bindings.filter((binding) => !(binding.to === to && binding.parameter === parameter))
    bindings.push({ from, to, parameter })
    showBindings(to)
}

function unbind(target: Binding) {
    bindings = bindings.filter((binding) => binding !== target)
    showBindings(target.to)
}

function showBindings(to: Slot) {
    const labels = new Map(to.instance.parameters().map((info) => [info.id, info.label]))
    to.bindings.replaceChildren(
        ...bindings
            .filter((binding) => binding.to === to)
            .map((binding) => {
                const item = document.createElement('li')
                item.textContent = `${binding.from.title} → ${labels.get(binding.parameter) ?? binding.parameter} `
                const drop = document.createElement('button')
                drop.type = 'button'
                drop.textContent = '×'
                drop.setAttribute('aria-label', 'Remove binding')
                drop.addEventListener('click', () => unbind(binding))
                item.append(drop)
                return item
            }),
    )
}

function remove(slot: Slot) {
    const touched = new Set(bindings.filter((binding) => binding.from === slot).map((binding) => binding.to))
    bindings = bindings.filter((binding) => binding.from !== slot && binding.to !== slot)
    for (const to of touched) {
        if (to !== slot) {
            showBindings(to)
        }
    }
    for (const stop of slot.stops) {
        stop()
    }
    slot.instance.dispose()
    slot.frame.remove()
    slots.delete(slot.id)
}

// Dragging the title bar moves the window. Its buttons and the source handle keep their own drags.
function moveWith(bar: HTMLElement, frame: HTMLElement) {
    let startX = 0
    let startY = 0
    let left = 0
    let top = 0
    frame.addEventListener('pointerdown', () => {
        frame.style.zIndex = String(nextZ++)
    })
    bar.addEventListener('pointerdown', (event) => {
        if (event.target instanceof Element && event.target.closest('button, .rack-source')) {
            return
        }
        startX = event.clientX
        startY = event.clientY
        left = frame.offsetLeft
        top = frame.offsetTop
        bar.setPointerCapture(event.pointerId)
    })
    bar.addEventListener('pointermove', (event) => {
        if (!bar.hasPointerCapture(event.pointerId)) {
            return
        }
        frame.style.left = `${Math.max(0, left + event.clientX - startX)}px`
        frame.style.top = `${Math.max(0, top + event.clientY - startY)}px`
    })
}

for (const kind of kinds) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `Add ${kind.factory.name}`
    button.addEventListener('click', () => void add(kind))
    toolbar.insertBefore(button, play)
}

play.addEventListener('click', () => {
    playing = !playing
    play.textContent = playing ? 'Stop' : 'Play'
    const bytes: [number, number, number] = playing ? [0x90, 36, 127] : [0x80, 36, 0]
    sendAll({ type: 'midi', time: context.currentTime, bytes })
})

tempoInput.value = String(bpm)
tempoInput.addEventListener('change', () => {
    const next = Math.round(tempoInput.valueAsNumber)
    if (next >= 1 && next <= 999) {
        bpm = next
        sendAll({ type: 'tempo', time: context.currentTime, bpm })
    }
    tempoInput.value = String(bpm)
})

void add(kinds[0]).then(() => add(kinds[0])).then(() => add(kinds[1]))
