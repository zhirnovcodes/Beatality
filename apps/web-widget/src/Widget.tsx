import { useEffect, useRef, useState } from 'preact/hooks'
import type { WebViewModel } from '../../../viewmodels/web/WebViewModel'
import './ui/skin/skin.css'
import './widget.css'

export function Widget({
    model,
    grid,
    bindPanel,
    listenSelection,
    chosen,
}: {
    model: WebViewModel
    grid: HTMLElement
    bindPanel: (panel: HTMLFieldSetElement) => void
    listenSelection: (listener: (index: number) => void) => void
    chosen: () => number
}) {
    const [, setTick] = useState(0)
    const [loadingPack, setLoadingPack] = useState(false)
    const [chosenIndex, setChosenIndex] = useState(-1)
    const skin = useRef<HTMLDivElement>(null)
    const bpmRef = useRef<HTMLInputElement>(null)
    const files = useRef<HTMLInputElement>(null)
    const placeGrid = useRef((host: HTMLDivElement | null) => {
        if (host && grid.parentElement !== host) {
            host.replaceChildren(grid)
        }
    }).current
    const onPanel = useRef((panel: HTMLFieldSetElement | null) => {
        if (panel) {
            bindPanel(panel)
        }
    }).current

    useEffect(() => model.subscribe(() => setTick((tick) => tick + 1)), [model])
    useEffect(() => listenSelection(setChosenIndex), [listenSelection])
    useEffect(() => {
        const root = skin.current
        if (!root) {
            return
        }
        return attachSampleScroll(root)
    }, [])
    useEffect(() => {
        const root = skin.current
        const bpm = bpmRef.current
        if (bpm && document.activeElement !== bpm) {
            bpm.value = String(clampBpm(model.bpm) ?? Math.round(model.bpm))
        }
        if (!root) {
            return
        }
        root.querySelectorAll<HTMLElement>('.slider, .seek, .mix-slider').forEach((slider) => {
            const input = slider.querySelector('input[type="range"]')
            if (input instanceof HTMLInputElement) {
                placeThumb(input)
            }
        })
    })

    const onPickClick = (event: Event) => {
        event.stopPropagation()
    }

    const onCancel = (event: Event) => {
        event.stopPropagation()
    }

    const onFiles = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        const picked = Array.from(input.files ?? [])
        if (picked.length === 0) {
            return
        }
        input.value = ''
        model.append(picked)
    }

    const commitBpm = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        const bpm = clampBpm(Number(input.value))
        if (bpm !== null) {
            model.setBpm(bpm)
        }
        input.value = String(clampBpm(model.bpm) ?? Math.round(model.bpm))
    }

    const bumpBpm = (delta: number) => {
        const bpm = clampBpm(Math.round(model.bpm) + delta)
        if (bpm === null) {
            return
        }
        model.setBpm(bpm)
        if (bpmRef.current) {
            bpmRef.current.value = String(model.bpm)
        }
    }

    const onLoop = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setLoop(input.valueAsNumber)
        input.value = String(model.loopBeats)
        placeThumb(input)
    }

    const onSlice = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setSlice(Number(input.value))
        input.value = String(model.sliceExp)
        placeThumb(input)
    }

    const onAttack = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setAttack(input.valueAsNumber)
        input.value = String(model.attackMs)
        placeThumb(input)
    }

    const onMasterVolume = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setOutput(input.valueAsNumber, model.outputPan)
        input.value = String(model.outputVolume)
        placeThumb(input)
    }

    const onMasterPan = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setOutput(model.outputVolume, input.valueAsNumber)
        input.value = String(model.outputPan)
        placeThumb(input)
    }

    const onLoadPack = () => {
        setLoadingPack(true)
        void model.loadPack().finally(() => setLoadingPack(false))
    }

    const onRemove = () => {
        if (!model.hasTracks) {
            return
        }
        const index = chosen()
        model.remove(index < 0 ? 0 : index)
    }

    const sliceLabel = model.sliceChoices.find((choice) => choice.exponent === model.sliceExp)?.label ?? ''

    return (
        <>
            <div className="beatality-skin" ref={skin}>
                <section className="part top" aria-label="Main controls">
                    <div className="window" />
                    <div className="content">
                        <div className="bpm-caption" aria-hidden="true" />
                        <div className="bpm-lcd" aria-hidden="true" />
                        <div className="bpm-field">
                            <input
                                ref={bpmRef}
                                type="text"
                                id="bpm"
                                defaultValue={Math.round(model.bpm)}
                                inputMode="numeric"
                                maxLength={3}
                                spellcheck={false}
                                autoComplete="off"
                                aria-label="BPM"
                                onChange={commitBpm}
                            />
                        </div>
                        <button type="button" className="bpm-btn plus" aria-label="BPM up" onClick={() => bumpBpm(1)}>
                            +
                        </button>
                        <button type="button" className="bpm-btn minus" aria-label="BPM down" onClick={() => bumpBpm(-1)}>
                            -
                        </button>

                        <span className="mix-caption volume">VOLUME</span>
                        <div className="mix-slider volume">
                            <div className="track" />
                            <div className="snap" />
                            <div className="thumb" />
                            <input
                                type="range"
                                id="master-volume"
                                min={0}
                                max={1.2}
                                step={0.01}
                                value={model.outputVolume}
                                data-snap="1"
                                aria-label="Volume"
                                onInput={onMasterVolume}
                            />
                        </div>
                        <span className="mix-caption pan">PAN</span>
                        <div className="mix-slider pan">
                            <div className="track" />
                            <div className="snap" />
                            <div className="thumb" />
                            <input
                                type="range"
                                id="master-pan"
                                min={-1}
                                max={1}
                                step={0.01}
                                value={model.outputPan}
                                data-snap="0"
                                aria-label="Pan"
                                onInput={onMasterPan}
                            />
                        </div>

                        <div className="seek" role="meter" aria-label="Playhead position" aria-valuemin={0} aria-valuemax={1}>
                            <div className="band" />
                            <div className="head" />
                            <input
                                type="range"
                                id="playhead"
                                min={0}
                                max={1}
                                step={0.001}
                                value={model.playhead}
                                disabled
                                tabIndex={-1}
                                aria-label="Playhead position"
                            />
                        </div>

                        <div className="slider-captions" aria-hidden="true">
                            <span data-for="loop">
                                LOOP: <b className="value">{model.loopBeats}</b>
                            </span>
                            <span data-for="slice">
                                SLICES: <b className="value">{sliceLabel}</b>
                            </span>
                            <span data-for="attack">
                                ATTACK: <b className="value">{model.attackMs}</b> <i className="unit">MS</i>
                            </span>
                        </div>
                        <div className="slider loop">
                            <div className="track" />
                            <div className="ticks dim" />
                            <div className="ticks lit" />
                            <div className="thumb" />
                            <input
                                type="range"
                                id="loop"
                                min={1}
                                max={32}
                                step={1}
                                value={model.loopBeats}
                                aria-label="Loop"
                                onInput={onLoop}
                            />
                        </div>
                        <div className="slider slice">
                            <div className="track" />
                            <div className="ticks dim" />
                            <div className="ticks lit" />
                            <div className="thumb" />
                            <input
                                type="range"
                                id="slice"
                                min={-4}
                                max={4}
                                step={1}
                                value={model.sliceExp}
                                aria-label="Slices"
                                onInput={onSlice}
                            />
                        </div>
                        <div className="slider attack">
                            <div className="track" />
                            <div className="ticks dim" />
                            <div className="ticks lit" />
                            <div className="thumb" />
                            <input
                                type="range"
                                id="attack"
                                min={2}
                                max={16}
                                step={1}
                                value={model.attackMs}
                                aria-label="Attack (ms)"
                                onInput={onAttack}
                            />
                        </div>
                    </div>
                    <div className="case" />
                    <div className="controls">
                        <button
                            type="button"
                            className="randomize"
                            id="randomize"
                            disabled={!model.hasTracks}
                            onClick={() => model.randomize()}
                        >
                            Randomize
                        </button>
                    </div>
                </section>
                <section className="part bottom" aria-label="Samples">
                    <div className="window" />
                    <div className="content">
                        <div className="viewport" id="sample-viewport" tabIndex={0}>
                            <div className="scroll-content" ref={placeGrid} />
                        </div>
                    </div>
                    <div className="case" />
                    <div className="controls">
                        <div
                            className="scrollbar"
                            data-scroll="sample-viewport"
                            role="scrollbar"
                            aria-controls="sample-viewport"
                            aria-orientation="vertical"
                        >
                            <div className="thumb" />
                        </div>
                        <button type="button" className="scroll-arrow up" aria-label="Scroll up" />
                        <button type="button" className="scroll-arrow down" aria-label="Scroll down" />

                        <button type="button" className="round-btn append" id="append" onClick={() => files.current?.click()}>
                            Add
                        </button>
                        <button type="button" className="round-btn remove" id="remove" disabled={!model.hasTracks} onClick={onRemove}>
                            Remove
                        </button>
                        <button type="button" className="round-btn clear" id="clear" disabled={!model.hasTracks} onClick={() => model.clear()}>
                            Clear
                        </button>
                        <button type="button" className="round-btn load" id="load-bank" disabled={loadingPack} onClick={onLoadPack}>
                            Load
                        </button>
                        <button type="button" className="round-btn save" id="save">
                            Save
                        </button>
                        <input
                            ref={files}
                            type="file"
                            accept=".wav,.mp3,audio/wav,audio/mpeg"
                            multiple
                            hidden
                            onClick={onPickClick}
                            onCancel={onCancel}
                            onChange={onFiles}
                        />

                        <fieldset className="sample-panel" id="selected-sample" disabled={chosenIndex < 0} ref={onPanel}>
                            <div className="col c1">
                                <span className="name top">VOLUME</span>
                                <div className="slider top">
                                    <div className="track" />
                                    <div className="snap" />
                                    <div className="thumb" />
                                    <input
                                        type="range"
                                        id="volume"
                                        min={0}
                                        max={1.2}
                                        step={0.01}
                                        defaultValue={1}
                                        aria-label="Volume"
                                        data-snap="1"
                                    />
                                </div>
                                <span className="name bottom">PAN</span>
                                <div className="slider bottom">
                                    <div className="track" />
                                    <div className="snap" />
                                    <div className="thumb" />
                                    <input
                                        type="range"
                                        id="pan"
                                        min={-1}
                                        max={1}
                                        step={0.01}
                                        defaultValue={0}
                                        aria-label="Pan"
                                        data-snap="0"
                                    />
                                </div>
                            </div>
                            <div className="col c2">
                                <span className="name top">START</span>
                                <div className="slider top">
                                    <div className="track" />
                                    <div className="thumb" />
                                    <input type="range" id="start" min={0} max={1} step={0.001} defaultValue={0} aria-label="Start" />
                                </div>
                                <span className="name bottom">LENGTH</span>
                                <div className="slider bottom">
                                    <div className="track" />
                                    <div className="thumb" />
                                    <input type="range" id="length" min={0} max={1} step={0.001} defaultValue={1} aria-label="Length" />
                                </div>
                            </div>
                            <div className="col c3">
                                <div className="time">
                                    <input
                                        type="text"
                                        id="start-time"
                                        defaultValue="0.00"
                                        inputMode="decimal"
                                        spellcheck={false}
                                        aria-label="Start (seconds)"
                                        data-max="0"
                                    />
                                    <span className="unit">SEC</span>
                                </div>
                                <span className="name loop">LOOP</span>
                                <input type="checkbox" className="toggle" id="track-loop" aria-label="Loop" />
                            </div>
                        </fieldset>
                    </div>
                </section>
            </div>
            <p id="error">{model.error}</p>
        </>
    )
}

function clampBpm(value: number): number | null {
    if (!Number.isFinite(value)) {
        return null
    }
    const bpm = Math.round(value)
    if (bpm < 1 || bpm > 999) {
        return null
    }
    return bpm
}

function placeThumb(input: HTMLInputElement) {
    const slider = input.closest('.slider, .seek, .mix-slider')
    if (!(slider instanceof HTMLElement)) {
        return
    }
    const min = Number(input.min)
    const max = Number(input.max)
    const value = Number(input.value)
    const pos = max > min ? (value - min) / (max - min) : 0
    slider.style.setProperty('--pos', String(pos))
    const snap = input.dataset.snap
    if (snap != null && snap !== '') {
        const target = Number(snap)
        slider.style.setProperty('--snap', String(max > min ? (target - min) / (max - min) : 0))
    }
}

function attachSampleScroll(root: ParentNode): () => void {
    const bar = root.querySelector('.scrollbar')
    const viewport = root.querySelector('.viewport')
    if (!(bar instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
        return () => {}
    }
    const thumb = bar.querySelector('.thumb')
    const part = bar.closest('.part')
    const up = part?.querySelector('.scroll-arrow.up')
    const down = part?.querySelector('.scroll-arrow.down')
    if (!(thumb instanceof HTMLElement)) {
        return () => {}
    }

    const step = 16
    const repeatDelay = 300
    const repeatEvery = 50
    const ac = new AbortController()
    const signal = ac.signal
    const travel = () => bar.clientHeight - thumb.offsetHeight
    const maxScroll = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const sync = () => {
        const max = maxScroll()
        thumb.style.top = (max ? viewport.scrollTop / max : 0) * travel() + 'px'
    }
    viewport.addEventListener('scroll', sync, { passive: true, signal })
    const observer = new ResizeObserver(sync)
    observer.observe(viewport)
    const content = viewport.querySelector('.sample-grid')
    if (content) {
        observer.observe(content)
    }
    sync()

    let startY = 0
    let startTop = 0
    thumb.addEventListener(
        'pointerdown',
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            thumb.setPointerCapture(event.pointerId)
            thumb.classList.add('dragging')
            startY = event.clientY
            startTop = viewport.scrollTop
        },
        { signal },
    )
    thumb.addEventListener(
        'pointermove',
        (event) => {
            if (!thumb.hasPointerCapture(event.pointerId)) {
                return
            }
            const room = travel()
            viewport.scrollTop = startTop + (event.clientY - startY) * (room ? maxScroll() / room : 0)
        },
        { signal },
    )
    const endDrag = () => thumb.classList.remove('dragging')
    thumb.addEventListener('pointerup', endDrag, { signal })
    thumb.addEventListener('pointercancel', endDrag, { signal })
    bar.addEventListener(
        'pointerdown',
        (event) => {
            if (event.target !== bar) {
                return
            }
            const above = event.clientY < thumb.getBoundingClientRect().top
            viewport.scrollBy({ top: (above ? -1 : 1) * viewport.clientHeight, behavior: 'smooth' })
        },
        { signal },
    )
    bar.addEventListener(
        'wheel',
        (event) => {
            event.preventDefault()
            viewport.scrollTop += event.deltaY
        },
        { passive: false, signal },
    )

    const stops: Array<() => void> = []
    for (const [btn, dy] of [
        [up, -step],
        [down, step],
    ] as const) {
        if (!(btn instanceof HTMLElement)) {
            continue
        }
        let delay = 0
        let timer = 0
        const stop = () => {
            window.clearTimeout(delay)
            window.clearInterval(timer)
        }
        stops.push(stop)
        btn.addEventListener(
            'pointerdown',
            (event) => {
                event.preventDefault()
                viewport.scrollTop += dy
                delay = window.setTimeout(() => {
                    timer = window.setInterval(() => {
                        viewport.scrollTop += dy
                    }, repeatEvery)
                }, repeatDelay)
            },
            { signal },
        )
        for (const name of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
            btn.addEventListener(name, stop, { signal })
        }
    }

    return () => {
        ac.abort()
        observer.disconnect()
        for (const stop of stops) {
            stop()
        }
    }
}
