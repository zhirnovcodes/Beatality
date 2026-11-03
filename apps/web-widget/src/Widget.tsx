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
    const [bankOpen, setBankOpen] = useState(false)
    const [bankIndex, setBankIndex] = useState(0)
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
    const chosenName = model.tracks[chosenIndex]?.name ?? ''

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
        root.querySelectorAll<HTMLElement>('.slider, .seek, .mix-slider, .fx-slider').forEach((slider) => {
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

    const onFx = (apply: (value: number) => void) => (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        apply(input.valueAsNumber)
        placeThumb(input)
    }

    const shuffleEffects = () => {
        model.setGlobalPower(randomUnit())
        model.setGlobalChance(randomUnit())
        model.setGlobalBeat(-4 + Math.floor(Math.random() * 6))
        model.setDelayPower(randomUnit())
        model.setDelayChance(randomUnit())
        model.setReverbPower(randomUnit())
        model.setReverbChance(randomUnit())
        model.setReversePower(randomUnit())
        model.setReverseChance(randomUnit())
        model.setFilterPower(randomUnit())
        model.setFilterChance(randomUnit())
        model.setFlangerPower(randomUnit())
        model.setFlangerChance(randomUnit())
        model.setTrancePower(randomUnit())
        model.setTranceChance(randomUnit())
        model.setShiftPower(randomUnit())
        model.setShiftChance(randomUnit())
    }

    const onSelectBank = () => {
        const bank = model.factoryBanks[bankIndex]
        if (!bank || loadingPack) {
            return
        }
        setLoadingPack(true)
        void model.loadPack(bank.file).finally(() => {
            setLoadingPack(false)
            setBankOpen(false)
        })
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
            <div className={bankOpen ? 'beatality-skin picking-bank' : 'beatality-skin'} ref={skin}>
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
                <section className="part effects" aria-label="Effects">
                    <div className="window" />
                    <div className="content">
                        <div className="fx-caps" aria-hidden="true">
                            <FxCap name="GLOBAL" left={31} />
                            <div className="fx-cap" style={{ left: '79px', width: '26px' }}>
                                <span className="clock" />
                            </div>
                            <FxCap name="DELAY" left={132} />
                            <FxCap name="REVERB" left={180} />
                            <FxCap name="REVERSE" left={228} />
                            <FxCap name="FILTER" left={276} />
                            <FxCap name="FLANGER" left={324} />
                            <FxCap name="TRANCE" left={372} />
                            <FxCap name="SHIFT" left={420} />
                        </div>
                        <div className="fx-sliders">
                            <FxSlider
                                id="fx-power"
                                label="Global power"
                                left={32}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.globalPower}
                                onInput={onFx((value) => model.setGlobalPower(value))}
                            />
                            <FxSlider
                                id="fx-chance"
                                label="Global chance (%)"
                                left={50}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.globalChance}
                                onInput={onFx((value) => model.setGlobalChance(value))}
                            />
                            <FxSlider
                                id="fx-time"
                                label="Effect time"
                                left={80}
                                min={-4}
                                max={1}
                                step={1}
                                value={model.globalBeatExp}
                                extraClass="time"
                                valueText={`${beatLabel(model.globalBeatExp)} beat`}
                                onInput={onFx((value) => model.setGlobalBeat(value))}
                            />
                            <FxSlider
                                id="fx-delay-power"
                                label="Delay power"
                                left={133}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.delayPower}
                                onInput={onFx((value) => model.setDelayPower(value))}
                            />
                            <FxSlider
                                id="fx-delay-chance"
                                label="Delay chance (%)"
                                left={151}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.delayChance}
                                onInput={onFx((value) => model.setDelayChance(value))}
                            />
                            <FxSlider
                                id="fx-reverb-power"
                                label="Reverb power"
                                left={181}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverbPower}
                                onInput={onFx((value) => model.setReverbPower(value))}
                            />
                            <FxSlider
                                id="fx-reverb-chance"
                                label="Reverb chance (%)"
                                left={199}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverbChance}
                                onInput={onFx((value) => model.setReverbChance(value))}
                            />
                            <FxSlider
                                id="fx-reverse-power"
                                label="Reverse power"
                                left={229}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reversePower}
                                onInput={onFx((value) => model.setReversePower(value))}
                            />
                            <FxSlider
                                id="fx-reverse-chance"
                                label="Reverse chance (%)"
                                left={247}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverseChance}
                                onInput={onFx((value) => model.setReverseChance(value))}
                            />
                            <FxSlider
                                id="fx-filter-power"
                                label="Filter power"
                                left={277}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.filterPower}
                                onInput={onFx((value) => model.setFilterPower(value))}
                            />
                            <FxSlider
                                id="fx-filter-chance"
                                label="Filter chance (%)"
                                left={295}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.filterChance}
                                onInput={onFx((value) => model.setFilterChance(value))}
                            />
                            <FxSlider
                                id="fx-flanger-power"
                                label="Flanger power"
                                left={325}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.flangerPower}
                                onInput={onFx((value) => model.setFlangerPower(value))}
                            />
                            <FxSlider
                                id="fx-flanger-chance"
                                label="Flanger chance (%)"
                                left={343}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.flangerChance}
                                onInput={onFx((value) => model.setFlangerChance(value))}
                            />
                            <FxSlider
                                id="fx-trance-power"
                                label="Trance power"
                                left={373}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.trancePower}
                                onInput={onFx((value) => model.setTrancePower(value))}
                            />
                            <FxSlider
                                id="fx-trance-chance"
                                label="Trance chance (%)"
                                left={391}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.tranceChance}
                                onInput={onFx((value) => model.setTranceChance(value))}
                            />
                            <FxSlider
                                id="fx-shift-power"
                                label="Shift power"
                                left={421}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.shiftPower}
                                onInput={onFx((value) => model.setShiftPower(value))}
                            />
                            <FxSlider
                                id="fx-shift-chance"
                                label="Shift chance (%)"
                                left={439}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.shiftChance}
                                onInput={onFx((value) => model.setShiftChance(value))}
                            />
                            <ol className="fx-scale" aria-hidden="true" style={{ left: '102px' }}>
                                <li>2</li>
                                <li>1</li>
                                <li>1/2</li>
                                <li>1/4</li>
                                <li>1/8</li>
                                <li>1/16</li>
                            </ol>
                        </div>
                        <button type="button" className="fx-randomize" id="fx-randomize" onClick={shuffleEffects}>
                            RANDOMIZE
                        </button>
                    </div>
                    <div className="case" />
                </section>
                <section className="part bottom" aria-label="Samples">
                    <div className="window" />
                    <div className="content">
                        <div className="viewport" id="sample-viewport" tabIndex={0}>
                            <div className="scroll-content">
                                <div ref={placeGrid} />
                                <div className="bank-view" id="bank-view">
                                    <div className="header">SELECT BANK</div>
                                    <ol className="bank-list" role="listbox" aria-label="Banks">
                                        {model.factoryBanks.map((bank, index) => (
                                            <li
                                                key={bank.file}
                                                role="option"
                                                aria-selected={index === bankIndex}
                                                onClick={() => setBankIndex(index)}
                                            >
                                                {index + 1}. {bank.name}
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            </div>
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

                        <button
                            type="button"
                            className="round-btn append"
                            id="append"
                            disabled={bankOpen}
                            onClick={() => files.current?.click()}
                        >
                            Add
                        </button>
                        <button
                            type="button"
                            className="round-btn remove"
                            id="remove"
                            disabled={bankOpen || !model.hasTracks}
                            onClick={onRemove}
                        >
                            Remove
                        </button>
                        <button
                            type="button"
                            className="round-btn clear"
                            id="clear"
                            disabled={bankOpen || !model.hasTracks}
                            onClick={() => model.clear()}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="round-btn load"
                            id="load-bank"
                            disabled={bankOpen}
                            onClick={() => {
                                setBankIndex(0)
                                setBankOpen(true)
                            }}
                        >
                            Load
                        </button>
                        <button
                            type="button"
                            className="round-btn save"
                            id="save"
                            disabled={bankOpen || !model.canSave}
                            onClick={() => model.save()}
                        >
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

                        <div className="bank-panel" id="bank-panel">
                            <button type="button" className="bank-btn" id="bank-select" disabled={loadingPack || model.factoryBanks.length === 0} onClick={onSelectBank}>
                                SELECT
                            </button>
                            <button type="button" className="bank-btn" id="bank-load-file" disabled={!model.canLoadFile} onClick={() => model.loadFile()}>
                                LOAD FILE
                            </button>
                            <button type="button" className="bank-btn close" id="bank-close" aria-label="Close" onClick={() => setBankOpen(false)}>
                                X
                            </button>
                        </div>
                        {/* Selected sample's file name, right of the buttons. The bank picker buttons take its place. */}
                        <div className="track-name" id="track-name" title={chosenName}>
                            {chosenName}
                        </div>
                        {/* Selected sample's controls, on the dark screen under the buttons:
                            VOL / PAN | ST. (start) / LEN. (length) | start time / LOOP | BPM | WARP (none, beat, pitch) | BEAT (1/32 .. 2) */}
                        <fieldset className="sample-panel" id="selected-sample" disabled={chosenIndex < 0} ref={onPanel}>
                            <span className="name vol">VOL</span>
                            <div className="slider vol">
                                <div className="track" />
                                <div className="snap" />
                                <div className="thumb" />
                                <input type="range" id="volume" min={0} max={1.2} step={0.01} defaultValue={1} aria-label="Volume" data-snap="1" />
                            </div>
                            <span className="name pan">PAN</span>
                            <div className="slider pan">
                                <div className="track" />
                                <div className="snap" />
                                <div className="thumb" />
                                <input type="range" id="pan" min={-1} max={1} step={0.01} defaultValue={0} aria-label="Pan" data-snap="0" />
                            </div>

                            <span className="name start">ST.</span>
                            <div className="slider start">
                                <div className="track" />
                                <div className="thumb" />
                                <input type="range" id="start" min={0} max={1} step={0.001} defaultValue={0} aria-label="Start" />
                            </div>
                            <span className="name length">LEN.</span>
                            <div className="slider length">
                                <div className="track" />
                                <div className="thumb" />
                                <input type="range" id="length" min={0} max={1} step={0.001} defaultValue={1} aria-label="Length" />
                            </div>

                            <input
                                type="text"
                                className="field time"
                                id="start-time"
                                defaultValue="0.00"
                                inputMode="decimal"
                                spellcheck={false}
                                aria-label="Start (seconds)"
                                data-max="0"
                            />
                            <span className="name loop">LOOP</span>
                            <input type="checkbox" className="toggle" id="track-loop" aria-label="Loop" />

                            <span className="name bpm">BPM</span>
                            <input
                                type="text"
                                className="field bpm"
                                id="track-bpm"
                                defaultValue="120.0"
                                inputMode="decimal"
                                spellcheck={false}
                                aria-label="Sample BPM"
                            />

                            <span className="name warp">WARP</span>
                            <button type="button" className="warp-btn prev" id="warp-prev" aria-label="Previous warp mode" />
                            <output className="warp-value" id="track-warp" data-value="none" aria-label="Warp">
                                NONE
                            </output>
                            <button type="button" className="warp-btn next" id="warp-next" aria-label="Next warp mode" />

                            <span className="name beat">
                                BEAT <b className="value" />
                            </span>
                            <div className="slider beat">
                                <div className="track" />
                                <div className="thumb" />
                                <input type="range" id="track-beat" min={0} max={6} step={1} defaultValue={3} aria-label="Beat" />
                            </div>
                        </fieldset>
                    </div>
                </section>
            </div>
            <BeatRepeatPanel model={model} />
            <p id="error">{model.error}</p>
        </>
    )
}

// Plain controls until beat repeat has its place in the skin.
// Size is 1/32 .. 2 beats, picked between min and max. The tail is 1/16 .. 2 beats.
function BeatRepeatPanel({ model }: { model: WebViewModel }) {
    const sizes = [-5, -4, -3, -2, -1, 0, 1]
    const lengths = [-4, -3, -2, -1, 0, 1]
    const pick = (apply: (exponent: number) => void) => (event: Event) => {
        const select = event.currentTarget as HTMLSelectElement
        apply(Number(select.value))
    }
    return (
        <fieldset className="beat-repeat">
            <legend>Beat repeat</legend>
            <label>
                <input
                    type="checkbox"
                    checked={model.repeatEnabled}
                    onChange={(event) => model.setRepeatEnabled((event.currentTarget as HTMLInputElement).checked)}
                />
                On
            </label>
            <label>
                Size min
                <select value={model.repeatSizeMinExp} onChange={pick((exponent) => model.setRepeatSizeMin(exponent))}>
                    {sizes.map((exponent) => (
                        <option key={exponent} value={exponent} disabled={exponent > model.repeatSizeMaxExp}>
                            {beatLabel(exponent)}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Size max
                <select value={model.repeatSizeMaxExp} onChange={pick((exponent) => model.setRepeatSizeMax(exponent))}>
                    {sizes.map((exponent) => (
                        <option key={exponent} value={exponent} disabled={exponent < model.repeatSizeMinExp}>
                            {beatLabel(exponent)}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Length
                <select value={model.repeatLengthExp} onChange={pick((exponent) => model.setRepeatLength(exponent))}>
                    {lengths.map((exponent) => (
                        <option key={exponent} value={exponent}>
                            {beatLabel(exponent)} beat
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Chance {Math.round(model.repeatChance * 100)}%
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={model.repeatChance}
                    onInput={(event) => model.setRepeatChance((event.currentTarget as HTMLInputElement).valueAsNumber)}
                />
            </label>
            <label>
                Mix {Math.round(model.repeatMix * 100)}%
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={model.repeatMix}
                    onInput={(event) => model.setRepeatMix((event.currentTarget as HTMLInputElement).valueAsNumber)}
                />
            </label>
            <div className="positions" role="group" aria-label="Positions">
                {model.repeatPositions.map((on, index) => (
                    <label key={index}>
                        <input
                            type="checkbox"
                            checked={on}
                            onChange={(event) => model.setRepeatPosition(index, (event.currentTarget as HTMLInputElement).checked)}
                        />
                        {index + 1}
                    </label>
                ))}
            </div>
        </fieldset>
    )
}

function FxCap({ name, left }: { name: string; left: number }) {
    return (
        <div className="fx-cap" style={{ left: `${left}px`, width: '44px' }}>
            <span className="name">{name}</span>
            <span className="sub" style={{ left: '13px' }}>
                PWR
            </span>
            <span className="sub" style={{ left: '31px' }}>
                %
            </span>
        </div>
    )
}

function FxSlider({
    id,
    label,
    left,
    min,
    max,
    step,
    value,
    idle,
    extraClass,
    valueText,
    onInput,
}: {
    id: string
    label: string
    left: number
    min: number
    max: number
    step: number
    value: number
    idle?: boolean
    extraClass?: string
    valueText?: string
    onInput?: (event: Event) => void
}) {
    const className = ['fx-slider', extraClass, idle ? 'idle' : ''].filter(Boolean).join(' ')
    return (
        <div className={className} style={{ left: `${left}px` }}>
            <div className="track" />
            <div className="fill" />
            <div className="thumb" />
            <input
                type="range"
                id={id}
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={idle}
                aria-label={label}
                aria-valuetext={valueText}
                onInput={onInput}
            />
        </div>
    )
}

function beatLabel(exponent: number): string {
    if (exponent >= 0) {
        return String(2 ** exponent)
    }
    return `1/${2 ** -exponent}`
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

function randomUnit(): number {
    return Math.round(Math.random() * 100) / 100
}

function placeThumb(input: HTMLInputElement) {
    const slider = input.closest('.slider, .seek, .mix-slider, .fx-slider')
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
    const content = viewport.querySelector('.scroll-content')
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
