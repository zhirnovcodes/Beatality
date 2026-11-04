import { useEffect, useId, useRef, useState } from 'preact/hooks'
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
    listenSelection: (listener: (selected: readonly number[]) => void) => void
    chosen: () => readonly number[]
}) {
    const [, setTick] = useState(0)
    const [loadingPack, setLoadingPack] = useState(false)
    const [bankOpen, setBankOpen] = useState(false)
    const [bankIndex, setBankIndex] = useState(0)
    const [selection, setSelection] = useState<readonly number[]>([])
    const skin = useRef<HTMLDivElement>(null)
    const viewportId = useId()
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
    const chosenName =
        selection.length === 0 ? 'none selected' : selection.length > 1 ? 'multiple selected' : (model.tracks[selection[0]]?.name ?? '')

    useEffect(() => model.subscribe(() => setTick((tick) => tick + 1)), [model])
    useEffect(() => listenSelection(setSelection), [listenSelection])
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
        if (bpm && (model.bpmSync || document.activeElement !== bpm)) {
            // 7-segment "5" stands in for the S.
            bpm.value = model.bpmSync ? '5YN' : String(clampBpm(model.bpm) ?? Math.round(model.bpm))
        }
        if (!root) {
            return
        }
        root.querySelectorAll<HTMLElement>('.slider, .seek, .mix-slider, .fx-slider, .br-slider').forEach((slider) => {
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
        if (model.bpmSync) {
            return
        }
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
        model.setOutput(input.valueAsNumber, model.outputPanMin, model.outputPanMax)
        input.value = String(model.outputVolume)
        placeThumb(input)
    }

    const onMasterPanMin = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setOutputPanMin(input.valueAsNumber)
        input.value = String(model.outputPanMin)
    }

    const onMasterPanMax = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setOutputPanMax(input.valueAsNumber)
        input.value = String(model.outputPanMax)
    }

    const onFx = (apply: (value: number) => void) => (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        apply(input.valueAsNumber)
        placeThumb(input)
    }

    const shuffleEffects = () => {
        model.setGlobalPower(randomUnit())
        model.setGlobalChance(randomUnit())
        const a = -4 + Math.floor(Math.random() * 6)
        const b = -4 + Math.floor(Math.random() * 6)
        model.setGlobalBeatMin(Math.min(a, b))
        model.setGlobalBeatMax(Math.max(a, b))
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
        const selected = chosen()
        if (selected.length === 0) {
            model.remove(0)
            return
        }
        // Highest first, so each index still names its row when its turn comes.
        for (const index of [...selected].sort((a, b) => b - a)) {
            model.remove(index)
        }
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
                                defaultValue={Math.round(model.bpm)}
                                inputMode="numeric"
                                maxLength={3}
                                spellcheck={false}
                                autoComplete="off"
                                aria-label={model.bpmSync ? 'BPM, synced to the project' : 'BPM'}
                                readOnly={model.bpmSync}
                                onChange={commitBpm}
                            />
                        </div>
                        <button
                            type="button"
                            className="bpm-btn plus"
                            aria-label="BPM up"
                            disabled={model.bpmSync}
                            onClick={() => bumpBpm(1)}
                        >
                            +
                        </button>
                        <button
                            type="button"
                            className="bpm-btn minus"
                            aria-label="BPM down"
                            disabled={model.bpmSync}
                            onClick={() => bumpBpm(-1)}
                        >
                            -
                        </button>
                        {/* On, the engine plays the project's tempo. */}
                        <button
                            type="button"
                            className="bpm-sync"
                            aria-pressed={model.bpmSync}
                            aria-label="Sync"
                            onClick={() => model.setBpmSync(!model.bpmSync)}
                        >
                            SYNC
                        </button>

                        <span className="mix-caption volume">VOLUME</span>
                        <div className="mix-slider volume">
                            <div className="track" />
                            <div className="snap" />
                            <div className="thumb" />
                            <input
                                type="range"
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
                        {/* Each slice's pan roll is scaled onto MIN..MAX. */}
                        <div
                            className="mix-range pan"
                            style={{ '--lo': String((model.outputPanMin + 1) / 2), '--hi': String((model.outputPanMax + 1) / 2) }}
                        >
                            <div className="track lit" />
                            <div className="track dark" />
                            <div className="snap" />
                            <div className="pin min" />
                            <div className="pin max" />
                            <input
                                type="range"
                                className="min"
                                min={-1}
                                max={1}
                                step={0.01}
                                value={model.outputPanMin}
                                aria-label="Pan minimum"
                                onInput={onMasterPanMin}
                            />
                            <input
                                type="range"
                                className="max"
                                min={-1}
                                max={1}
                                step={0.01}
                                value={model.outputPanMax}
                                aria-label="Pan maximum"
                                onInput={onMasterPanMax}
                            />
                        </div>

                        <div className="seek" role="meter" aria-label="Playhead position" aria-valuemin={0} aria-valuemax={1}>
                            <div className="band" />
                            <div className="head" />
                            <input
                                type="range"
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
                        <button
                            type="button"
                            className="fx-btn fx-enable"
                            aria-pressed={model.effectsEnabled}
                            onClick={() => model.setEffectsEnabled(!model.effectsEnabled)}
                        >
                            {model.effectsEnabled ? 'EFFECTS ON' : 'EFFECTS OFF'}
                        </button>
                        <button type="button" className="fx-btn fx-shuffle" onClick={shuffleEffects}>
                            SHUFFLE
                        </button>
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
                                label="Global power"
                                left={32}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.globalPower}
                                onInput={onFx((value) => model.setGlobalPower(value))}
                            />
                            <FxSlider
                                label="Global chance (%)"
                                left={50}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.globalChance}
                                onInput={onFx((value) => model.setGlobalChance(value))}
                            />
                            <div
                                className="fx-slider time"
                                style={{
                                    left: '80px',
                                    '--lo': String((model.globalBeatMinExp + 4) / 5),
                                    '--hi': String((model.globalBeatMaxExp + 4) / 5),
                                }}
                            >
                                <div className="track" />
                                <div className="fill" />
                                <div className="thumb max" />
                                <div className="thumb min" />
                                <input
                                    type="range"
                                    className="min"
                                    min={-4}
                                    max={1}
                                    step={1}
                                    value={model.globalBeatMinExp}
                                    aria-label="Effect time minimum"
                                    aria-valuetext={`${beatLabel(model.globalBeatMinExp)} beat`}
                                    onInput={(event) => model.setGlobalBeatMin((event.currentTarget as HTMLInputElement).valueAsNumber)}
                                />
                                <input
                                    type="range"
                                    className="max"
                                    min={-4}
                                    max={1}
                                    step={1}
                                    value={model.globalBeatMaxExp}
                                    aria-label="Effect time maximum"
                                    aria-valuetext={`${beatLabel(model.globalBeatMaxExp)} beat`}
                                    onInput={(event) => model.setGlobalBeatMax((event.currentTarget as HTMLInputElement).valueAsNumber)}
                                />
                            </div>
                            <FxSlider
                                label="Delay power"
                                left={133}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.delayPower}
                                onInput={onFx((value) => model.setDelayPower(value))}
                            />
                            <FxSlider
                                label="Delay chance (%)"
                                left={151}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.delayChance}
                                onInput={onFx((value) => model.setDelayChance(value))}
                            />
                            <FxSlider
                                label="Reverb power"
                                left={181}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverbPower}
                                onInput={onFx((value) => model.setReverbPower(value))}
                            />
                            <FxSlider
                                label="Reverb chance (%)"
                                left={199}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverbChance}
                                onInput={onFx((value) => model.setReverbChance(value))}
                            />
                            <FxSlider
                                label="Reverse power"
                                left={229}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reversePower}
                                onInput={onFx((value) => model.setReversePower(value))}
                            />
                            <FxSlider
                                label="Reverse chance (%)"
                                left={247}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverseChance}
                                onInput={onFx((value) => model.setReverseChance(value))}
                            />
                            <FxSlider
                                label="Filter power"
                                left={277}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.filterPower}
                                onInput={onFx((value) => model.setFilterPower(value))}
                            />
                            <FxSlider
                                label="Filter chance (%)"
                                left={295}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.filterChance}
                                onInput={onFx((value) => model.setFilterChance(value))}
                            />
                            <FxSlider
                                label="Flanger power"
                                left={325}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.flangerPower}
                                onInput={onFx((value) => model.setFlangerPower(value))}
                            />
                            <FxSlider
                                label="Flanger chance (%)"
                                left={343}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.flangerChance}
                                onInput={onFx((value) => model.setFlangerChance(value))}
                            />
                            <FxSlider
                                label="Trance power"
                                left={373}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.trancePower}
                                onInput={onFx((value) => model.setTrancePower(value))}
                            />
                            <FxSlider
                                label="Trance chance (%)"
                                left={391}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.tranceChance}
                                onInput={onFx((value) => model.setTranceChance(value))}
                            />
                            <FxSlider
                                label="Shift power"
                                left={421}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.shiftPower}
                                onInput={onFx((value) => model.setShiftPower(value))}
                            />
                            <FxSlider
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
                    </div>
                    <div className="case" />
                </section>
                <BeatRepeatPart model={model} />
                <section className="part bottom" aria-label="Samples">
                    <div className="window" />
                    <div className="content">
                        <div className="viewport" id={viewportId} tabIndex={0}>
                            <div className="scroll-content">
                                <div ref={placeGrid} />
                                <div className="bank-view">
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
                            role="scrollbar"
                            aria-controls={viewportId}
                            aria-orientation="vertical"
                        >
                            <div className="thumb" />
                        </div>
                        <button type="button" className="scroll-arrow up" aria-label="Scroll up" />
                        <button type="button" className="scroll-arrow down" aria-label="Scroll down" />

                        <button
                            type="button"
                            className="round-btn append"
                            disabled={bankOpen}
                            onClick={() => files.current?.click()}
                        >
                            Add
                        </button>
                        <button
                            type="button"
                            className="round-btn remove"
                            disabled={bankOpen || !model.hasTracks}
                            onClick={onRemove}
                        >
                            Remove
                        </button>
                        <button
                            type="button"
                            className="round-btn clear"
                            disabled={bankOpen || !model.hasTracks}
                            onClick={() => model.clear()}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="round-btn load"
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

                        <div className="bank-panel">
                            <button type="button" className="bank-btn" disabled={loadingPack || model.factoryBanks.length === 0} onClick={onSelectBank}>
                                SELECT
                            </button>
                            <button type="button" className="bank-btn" disabled={!model.canLoadFile} onClick={() => model.loadFile()}>
                                LOAD FILE
                            </button>
                            <button type="button" className="bank-btn close" aria-label="Close" onClick={() => setBankOpen(false)}>
                                X
                            </button>
                        </div>
                        {/* Selected sample's file name, right of the buttons. The bank picker buttons take its place. */}
                        <div className="track-name" title={chosenName}>
                            {chosenName}
                        </div>
                        {/* Selected sample's controls, on the dark screen under the buttons:
                            VOL / PAN | ST. (start) / LEN. (length) | start time / LOOP | BPM | WARP (none, beat, pitch) | BEAT (1/32 .. 2) */}
                        <fieldset className="sample-panel" disabled={selection.length === 0} ref={onPanel}>
                            <span className="name vol">VOL</span>
                            <div className="slider vol">
                                <div className="track" />
                                <div className="snap" />
                                <div className="thumb" />
                                <input type="range" min={0} max={1.2} step={0.01} defaultValue={1} aria-label="Volume" data-snap="1" />
                            </div>
                            <span className="name pan">PAN</span>
                            <div className="slider pan">
                                <div className="track" />
                                <div className="snap" />
                                <div className="thumb" />
                                <input type="range" min={-1} max={1} step={0.01} defaultValue={0} aria-label="Pan" data-snap="0" />
                            </div>

                            <span className="name start">ST.</span>
                            <div className="slider start">
                                <div className="track" />
                                <div className="thumb" />
                                <input type="range" min={0} max={1} step={0.001} defaultValue={0} aria-label="Start" />
                            </div>
                            <span className="name length">LEN.</span>
                            <div className="slider length">
                                <div className="track" />
                                <div className="thumb" />
                                <input type="range" min={0} max={1} step={0.001} defaultValue={1} aria-label="Length" />
                            </div>

                            <input
                                type="text"
                                className="field time"
                                defaultValue="0.00"
                                inputMode="decimal"
                                spellcheck={false}
                                aria-label="Start (seconds)"
                                data-max="0"
                            />
                            <span className="name loop">LOOP</span>
                            <input type="checkbox" className="toggle" aria-label="Loop" />

                            <span className="name bpm">BPM</span>
                            <input
                                type="text"
                                className="field bpm"
                                defaultValue="120.0"
                                inputMode="decimal"
                                spellcheck={false}
                                aria-label="Sample BPM"
                            />

                            <span className="name warp">WARP</span>
                            <button type="button" className="warp-btn prev" aria-label="Previous warp mode" />
                            <output className="warp-value" data-value="none" aria-label="Warp">
                                NONE
                            </output>
                            <button type="button" className="warp-btn next" aria-label="Next warp mode" />

                            <span className="name beat">
                                BEAT <b className="value" />
                            </span>
                            <div className="slider beat">
                                <div className="track" />
                                <div className="thumb" />
                                <input type="range" min={0} max={6} step={1} defaultValue={3} aria-label="Beat" />
                            </div>
                        </fieldset>
                    </div>
                </section>
            </div>
            <p className="widget-error">{model.error}</p>
        </>
    )
}

// SIZE index 0..6 is the exponent -5..1 (1/32 .. 2 beats). LENGTH index 0..5 is -4..1 (1/16 .. 2 beats).
const repeatSizeBase = -5
const repeatLengthBase = -4

function BeatRepeatPart({ model }: { model: WebViewModel }) {
    const lo = model.repeatSizeMinExp - repeatSizeBase
    const hi = model.repeatSizeMaxExp - repeatSizeBase
    const length = model.repeatLengthExp - repeatLengthBase
    const lengthId = useId()
    const value = (event: Event) => (event.currentTarget as HTMLInputElement).valueAsNumber
    const onSlider = (apply: (value: number) => void) => (event: Event) => {
        apply(value(event))
        placeThumb(event.currentTarget as HTMLInputElement)
    }
    return (
        <section className="part beatrepeat" aria-label="Beat repeat">
            <div className="window" />
            <div className="content">
                <button
                    type="button"
                    className="br-power"
                    aria-pressed={model.repeatEnabled}
                    onClick={() => model.setRepeatEnabled(!model.repeatEnabled)}
                >
                    {model.repeatEnabled ? 'ON' : 'OFF'}
                </button>
                <span className="br-name pos">POS.</span>
                <div className="br-positions" role="group" aria-label="Positions">
                    {model.repeatPositions.map((on, index) => (
                        <input
                            key={index}
                            type="checkbox"
                            className="br-pos"
                            style={{ left: `${84 + index * 14}px` }}
                            aria-label={`Position ${index + 1}`}
                            checked={on}
                            onChange={(event) => model.setRepeatPosition(index, (event.currentTarget as HTMLInputElement).checked)}
                        />
                    ))}
                </div>

                <span className="br-name size">SIZE</span>
                <div className="br-scale" aria-hidden="true" />
                <div className="br-range" style={{ '--lo': String(lo / 6), '--hi': String(hi / 6) }}>
                    <div className="track lit" />
                    <div className="track dark" />
                    <div className="pin min" />
                    <div className="pin max" />
                    <input
                        type="range"
                        className="min"
                        min={0}
                        max={6}
                        step={1}
                        value={lo}
                        aria-label="Size minimum"
                        aria-valuetext={`${beatLabel(model.repeatSizeMinExp)} beat`}
                        onInput={(event) => model.setRepeatSizeMin(value(event) + repeatSizeBase)}
                    />
                    <input
                        type="range"
                        className="max"
                        min={0}
                        max={6}
                        step={1}
                        value={hi}
                        aria-label="Size maximum"
                        aria-valuetext={`${beatLabel(model.repeatSizeMaxExp)} beat`}
                        onInput={(event) => model.setRepeatSizeMax(value(event) + repeatSizeBase)}
                    />
                </div>
                <span className="br-name mix">MIX</span>
                <div className="br-slider long mix">
                    <div className="track" />
                    <div className="thumb" />
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={model.repeatMix}
                        aria-label="Mix"
                        onInput={onSlider((mix) => model.setRepeatMix(mix))}
                    />
                </div>

                <span className="br-name length">LENGTH</span>
                <output className="br-value length" htmlFor={lengthId} aria-hidden="true" data-i={length}>
                    {beatLabel(model.repeatLengthExp)}
                </output>
                <div className="br-slider short length">
                    <div className="track" />
                    <div className="thumb" />
                    <input
                        type="range"
                        id={lengthId}
                        min={0}
                        max={5}
                        step={1}
                        value={length}
                        aria-label="Length"
                        aria-valuetext={`${beatLabel(model.repeatLengthExp)} beat`}
                        onInput={onSlider((index) => model.setRepeatLength(index + repeatLengthBase))}
                    />
                </div>
                <span className="br-name chance">CHANCE</span>
                <div className="br-slider short chance">
                    <div className="track" />
                    <div className="thumb" />
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={model.repeatChance}
                        aria-label="Chance"
                        onInput={onSlider((chance) => model.setRepeatChance(chance))}
                    />
                </div>
            </div>
            <div className="case" />
        </section>
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
    const slider = input.closest('.slider, .seek, .mix-slider, .fx-slider, .br-slider')
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
