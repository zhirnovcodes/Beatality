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
    // The SAMPLE SETTINGS drawer's button only slides it out or back.
    const [settingsOpen, setSettingsOpen] = useState(false)
    const settingsId = useId()
    const [bankIndex, setBankIndex] = useState(0)
    const [selection, setSelection] = useState<readonly number[]>([])
    const [dropping, setDropping] = useState(false)
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
        root.querySelectorAll<HTMLElement>('.slider, .seek, .mix-slider, .fx-slider, .br-slider, .chaos-slider, .chaos-small').forEach((slider) => {
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

    // Files dropped on the sample screen are appended, like the Add button's picks.
    const onDragOver = (event: DragEvent) => {
        if (bankOpen || !event.dataTransfer?.types.includes('Files')) {
            return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropping(true)
    }

    const onDragLeave = (event: DragEvent) => {
        const area = event.currentTarget as HTMLElement
        if (!(event.relatedTarget instanceof Node && area.contains(event.relatedTarget))) {
            setDropping(false)
        }
    }

    const onDrop = (event: DragEvent) => {
        event.preventDefault()
        setDropping(false)
        const dropped = Array.from(event.dataTransfer?.files ?? [])
        if (!bankOpen && dropped.length > 0) {
            model.append(dropped)
        }
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
        model.setOutput(snapTo(input.valueAsNumber, 0, 1.2, 1), model.outputPanMin, model.outputPanMax)
        input.value = String(model.outputVolume)
        placeThumb(input)
    }

    const onMasterPanMin = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setOutputPanMin(snapTo(input.valueAsNumber, -1, 1, 0))
        input.value = String(model.outputPanMin)
    }

    const onMasterPanMax = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setOutputPanMax(snapTo(input.valueAsNumber, -1, 1, 0))
        input.value = String(model.outputPanMax)
    }

    const onFx = (apply: (value: number) => void) => (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        apply(input.valueAsNumber)
        placeThumb(input)
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
            <div
                className={bankOpen ? 'beatality-skin picking-bank' : 'beatality-skin'}
                ref={skin}
            >
                <aside className={settingsOpen ? 'ss-drawer open' : 'ss-drawer'} aria-label="Sample settings">
                    <div className="window" />
                    <div className="content" id={settingsId}>
                        {/* The selected sample's controls: VOL / PAN, ST. / start time, LEN. / LOOP,
                            then WARPING: TYPE (none, beat, pitch) / BPM, SIZE (1/32 .. 2) */}
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

                            <span className="name warping">WARPING</span>
                            <span className="name warp">TYPE</span>
                            <button type="button" className="warp-btn prev" aria-label="Previous warp mode" />
                            <output className="warp-value" data-value="none" aria-label="Warp">
                                NONE
                            </output>
                            <button type="button" className="warp-btn next" aria-label="Next warp mode" />

                            <span className="name beat">
                                SIZE <b className="value" />
                            </span>
                            <div className="slider beat">
                                <div className="track" />
                                <div className="thumb" />
                                <input type="range" min={0} max={6} step={1} defaultValue={3} aria-label="Beat" />
                            </div>
                        </fieldset>
                    </div>
                    <div className="case" />
                    <button
                        type="button"
                        className="ss-drawer-btn"
                        aria-expanded={settingsOpen}
                        aria-controls={settingsId}
                        onClick={() => setSettingsOpen(!settingsOpen)}
                    >
                        Sample settings
                    </button>
                </aside>
                <BeatRepeatPart model={model} />
                <ChaosSides model={model} />
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
                        {/* On, a slice that starts on the slice already playing restarts it. */}
                        <button
                            type="button"
                            className="retrig"
                            aria-pressed={model.retrig}
                            aria-label="Retrigger"
                            onClick={() => model.setRetrig(!model.retrig)}
                        >
                            RTRG
                        </button>
                        {/* Clicks between the sliders pass through to SYN, + / - and RTRG. */}
                        <div className="main-sliders">
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
                                    data-param="volume"
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
                                    data-param="panMin"
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
                                    data-param="panMax"
                                    onInput={onMasterPanMax}
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
                                    data-param="loop"
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
                                    data-param="slice"
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
                    </div>
                    <div className="case" />
                    <div className="controls">
                        <button
                            type="button"
                            className="randomize"
                            data-param="randomize"
                            onClick={() => model.randomize()}
                        >
                            Randomize sequence
                        </button>
                    </div>
                </section>
                <section className="part effects" aria-label="Effects">
                    <div className="window" />
                    <div className="content">
                        <button
                            type="button"
                            className="fx-btn fx-enable"
                            data-param="effectsOn"
                            aria-pressed={model.effectsEnabled}
                            onClick={() => model.setEffectsEnabled(!model.effectsEnabled)}
                        >
                            {model.effectsEnabled ? 'EFFECTS ON' : 'EFFECTS OFF'}
                        </button>
                        <button type="button" className="fx-btn fx-shuffle" data-param="shuffle" onClick={() => model.shuffleEffects()}>
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
                                param="globalPower"
                                left={32}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.globalPower}
                                onInput={onFx((value) => model.setGlobalPower(value))}
                            />
                            <FxSlider
                                label="Global chance (%)"
                                param="globalChance"
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
                                    data-param="fxTimeMin"
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
                                    data-param="fxTimeMax"
                                    aria-valuetext={`${beatLabel(model.globalBeatMaxExp)} beat`}
                                    onInput={(event) => model.setGlobalBeatMax((event.currentTarget as HTMLInputElement).valueAsNumber)}
                                />
                            </div>
                            <FxSlider
                                label="Delay power"
                                param="delayPower"
                                left={133}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.delayPower}
                                onInput={onFx((value) => model.setDelayPower(value))}
                            />
                            <FxSlider
                                label="Delay chance (%)"
                                param="delayChance"
                                left={151}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.delayChance}
                                onInput={onFx((value) => model.setDelayChance(value))}
                            />
                            <FxSlider
                                label="Reverb power"
                                param="reverbPower"
                                left={181}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverbPower}
                                onInput={onFx((value) => model.setReverbPower(value))}
                            />
                            <FxSlider
                                label="Reverb chance (%)"
                                param="reverbChance"
                                left={199}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverbChance}
                                onInput={onFx((value) => model.setReverbChance(value))}
                            />
                            <FxSlider
                                label="Reverse power"
                                param="reversePower"
                                left={229}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reversePower}
                                onInput={onFx((value) => model.setReversePower(value))}
                            />
                            <FxSlider
                                label="Reverse chance (%)"
                                param="reverseChance"
                                left={247}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.reverseChance}
                                onInput={onFx((value) => model.setReverseChance(value))}
                            />
                            <FxSlider
                                label="Filter power"
                                param="filterPower"
                                left={277}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.filterPower}
                                onInput={onFx((value) => model.setFilterPower(value))}
                            />
                            <FxSlider
                                label="Filter chance (%)"
                                param="filterChance"
                                left={295}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.filterChance}
                                onInput={onFx((value) => model.setFilterChance(value))}
                            />
                            <FxSlider
                                label="Flanger power"
                                param="flangerPower"
                                left={325}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.flangerPower}
                                onInput={onFx((value) => model.setFlangerPower(value))}
                            />
                            <FxSlider
                                label="Flanger chance (%)"
                                param="flangerChance"
                                left={343}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.flangerChance}
                                onInput={onFx((value) => model.setFlangerChance(value))}
                            />
                            <FxSlider
                                label="Trance power"
                                param="trancePower"
                                left={373}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.trancePower}
                                onInput={onFx((value) => model.setTrancePower(value))}
                            />
                            <FxSlider
                                label="Trance chance (%)"
                                param="tranceChance"
                                left={391}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.tranceChance}
                                onInput={onFx((value) => model.setTranceChance(value))}
                            />
                            <FxSlider
                                label="Shift power"
                                param="shiftPower"
                                left={421}
                                min={0}
                                max={1}
                                step={0.01}
                                value={model.shiftPower}
                                onInput={onFx((value) => model.setShiftPower(value))}
                            />
                            <FxSlider
                                label="Shift chance (%)"
                                param="shiftChance"
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
                <section className="part bottom" aria-label="Samples">
                    <div className="window" />
                    <div className="content">
                        <div
                            className={dropping ? 'viewport dropping' : 'viewport'}
                            id={viewportId}
                            tabIndex={0}
                            onDragOver={onDragOver}
                            onDragLeave={onDragLeave}
                            onDrop={onDrop}
                        >
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
                    </div>
                </section>
            </div>
            <p className="widget-error">{model.error}</p>
        </>
    )
}

// 2^exponent as a fraction or a whole number.
function powerLabel(exponent: number): string {
    return exponent >= 0 ? String(2 ** exponent) : `1/${2 ** -exponent}`
}

// Trigger names in bt::ChaosTrigger order.
const chaosTriggerNames = ['RAND BTN', 'NOTE', 'LOOP', 'SLICES', 'BEAT', 'NONE']

// One toggle row: the caption, then its box. group is the bt::ChaosGroup number.
function ChaosToggle({ model, name, group }: { model: WebViewModel; name: string; group: number }) {
    return (
        <label className="chaos-tog">
            {name}
            <input
                type="checkbox"
                checked={model.chaosGroups[group]}
                onChange={(event) => model.setChaosGroup(group, (event.currentTarget as HTMLInputElement).checked)}
            />
        </label>
    )
}

interface ChaosSize {
    trigger: number
    min: number
    max: number
    value: number
    param: string
    label: string
    caption: string
    set: (value: number) => void
}

// The CHAOS drawer, out of the top part's right edge. Its button only slides it out or back. Loop, Slices and Beats each
// have a size slider; only the one for the chosen trigger shows. Beats size is 2^n beats, slices size is 2^n slices.
function ChaosSides({ model }: { model: WebViewModel }) {
    const [open, setOpen] = useState(false)
    const contentId = useId()
    const trigger = model.chaosTrigger
    const count = chaosTriggerNames.length
    const onRange = (apply: (value: number) => void) => (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        apply(input.valueAsNumber)
        placeThumb(input)
    }
    const sizes: ChaosSize[] = [
        {
            trigger: 2,
            min: 1,
            max: 8,
            value: model.chaosLoopSize,
            param: 'chaosLoopSize',
            label: 'Loops',
            caption: `LOOPS (${model.chaosLoopSize})`,
            set: (value) => model.setChaosLoopSize(value),
        },
        {
            trigger: 3,
            min: -1,
            max: 2,
            value: model.chaosSliceSize,
            param: 'chaosSliceSize',
            label: 'Slices',
            caption: `SLICES (${powerLabel(model.chaosSliceSize)})`,
            set: (value) => model.setChaosSliceSize(value),
        },
        {
            trigger: 4,
            min: -2,
            max: 1,
            value: model.chaosBeatSize,
            param: 'chaosBeatSize',
            label: 'Beats',
            caption: `BEATS (${powerLabel(model.chaosBeatSize)})`,
            set: (value) => model.setChaosBeatSize(value),
        },
    ]
    const chosen = sizes.find((size) => size.trigger === trigger)
    return (
        <aside className={open ? 'chaos-drawer open' : 'chaos-drawer'} aria-label="Chaos">
            <div className="window" />
            <div className="content" id={contentId}>
                <div className="chaos-title" aria-hidden="true" />
                <div className="chaos-slider">
                    <div className="track" />
                    <div className="fill" />
                    <div className="star" />
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={model.chaosValue}
                        data-param="chaosValue"
                        aria-label="Chaos value"
                        onInput={onRange((value) => model.setChaosValue(value))}
                    />
                </div>
                <span className="chaos-cap trigger">TRIGGER</span>
                <button
                    type="button"
                    className="chaos-arrow prev"
                    aria-label="Previous trigger"
                    onClick={() => model.setChaosTrigger((trigger + count - 1) % count)}
                />
                <output className="chaos-trigger">{chaosTriggerNames[trigger] ?? ''}</output>
                <button
                    type="button"
                    className="chaos-arrow next"
                    aria-label="Next trigger"
                    onClick={() => model.setChaosTrigger((trigger + 1) % count)}
                />
                <span className="chaos-cap amount" style={{ visibility: chosen ? 'visible' : 'hidden' }}>
                    {chosen?.caption ?? ''}
                </span>
                {sizes.map((size) => (
                    <div key={size.param} className={size === chosen ? 'chaos-small on' : 'chaos-small'}>
                        <div className="track" />
                        <div className="thumb" />
                        <input
                            type="range"
                            min={size.min}
                            max={size.max}
                            step="1"
                            value={size.value}
                            data-param={size.param}
                            aria-label={size.label}
                            onInput={onRange(size.set)}
                        />
                    </div>
                ))}
                <div className="chaos-group-box g-chaos">
                    <span className="chaos-cap">CHAOS</span>
                    <ChaosToggle model={model} name="VALUE" group={9} />
                    <ChaosToggle model={model} name="TIME" group={10} />
                </div>
                <div className="chaos-group-box g-play">
                    <span className="chaos-cap">PLAY</span>
                    <ChaosToggle model={model} name="PAN" group={0} />
                    <ChaosToggle model={model} name="SLICES" group={1} />
                    <ChaosToggle model={model} name="SEQUENCE" group={2} />
                </div>
                <div className="chaos-group-box g-fx">
                    <span className="chaos-cap">EFFECTS</span>
                    <ChaosToggle model={model} name="ON/OFF" group={4} />
                    <ChaosToggle model={model} name="GLOBAL" group={3} />
                    <ChaosToggle model={model} name="PER-EFFECT" group={5} />
                </div>
                <div className="chaos-group-box g-br">
                    <span className="chaos-cap">BEAT REPEAT</span>
                    <ChaosToggle model={model} name="ON/OFF" group={6} />
                    <ChaosToggle model={model} name="POSITIONS" group={7} />
                    <ChaosToggle model={model} name="PARAMS" group={8} />
                </div>
            </div>
            <div className="case" />
            <button
                type="button"
                className="chaos-drawer-btn"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={() => setOpen(!open)}
            >
                Chaos
            </button>
        </aside>
    )
}

// SIZE index 0..6 is the exponent -5..1 (1/32 .. 2 beats). LENGTH index 0..5 is -4..1 (1/16 .. 2 beats).
const repeatSizeBase = -5
const repeatLengthBase = -4

// The BEAT REPEAT drawer, beside the effects part. Its button only slides it out or back.
function BeatRepeatPart({ model }: { model: WebViewModel }) {
    const [open, setOpen] = useState(false)
    const lo = model.repeatSizeMinExp - repeatSizeBase
    const hi = model.repeatSizeMaxExp - repeatSizeBase
    const length = model.repeatLengthExp - repeatLengthBase
    const lengthId = useId()
    const contentId = useId()
    const value = (event: Event) => (event.currentTarget as HTMLInputElement).valueAsNumber
    const onSlider = (apply: (value: number) => void) => (event: Event) => {
        apply(value(event))
        placeThumb(event.currentTarget as HTMLInputElement)
    }
    return (
        <aside className={open ? 'br-drawer open' : 'br-drawer'} aria-label="Beat repeat">
            <div className="window" />
            <div className="content" id={contentId}>
                <span className="br-name size">
                    SIZE{' '}
                    <output aria-hidden="true">
                        [{beatLabel(model.repeatSizeMinExp)},{beatLabel(model.repeatSizeMaxExp)}]
                    </output>
                </span>
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
                        data-param="repeatSizeMin"
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
                        data-param="repeatSizeMax"
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
                        data-param="repeatMix"
                        onInput={onSlider((mix) => model.setRepeatMix(mix))}
                    />
                </div>

                <span className="br-name length">
                    LEN{' '}
                    <output htmlFor={lengthId} aria-hidden="true">
                        {beatLabel(model.repeatLengthExp)}
                    </output>
                </span>
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
                        data-param="repeatLength"
                        aria-valuetext={`${beatLabel(model.repeatLengthExp)} beat`}
                        onInput={onSlider((index) => model.setRepeatLength(index + repeatLengthBase))}
                    />
                </div>
                <span className="br-name chance">%</span>
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
                        data-param="repeatChance"
                        onInput={onSlider((chance) => model.setRepeatChance(chance))}
                    />
                </div>
            </div>
            <div className="case" />
            <div className="controls">
                <button
                    type="button"
                    className="br-power"
                    aria-pressed={model.repeatEnabled}
                    aria-label="Beat repeat on"
                    data-param="repeatOn"
                    onClick={() => model.setRepeatEnabled(!model.repeatEnabled)}
                >
                    ON
                </button>
                {/* LOOP PARTS: 8 numbered buttons on the metal. Each one's place and images come from skin.css. */}
                <div className="br-parts" role="group" aria-label="Loop parts">
                    {model.repeatPositions.map((on, index) => (
                        <input
                            key={index}
                            type="checkbox"
                            className="br-part"
                            aria-label={`Loop part ${index + 1}`}
                            checked={on}
                            onChange={(event) => model.setRepeatPosition(index, (event.currentTarget as HTMLInputElement).checked)}
                        />
                    ))}
                </div>
            </div>
            <button
                type="button"
                className="br-drawer-btn"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={() => setOpen(!open)}
            >
                Beat repeat
            </button>
        </aside>
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
    param,
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
    // The host parameter this slider drives.
    param?: string
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
                data-param={param}
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

// The mouse lands on target when it is within 4% of the range. Automation does not snap.
function snapTo(value: number, min: number, max: number, target: number): number {
    if (Math.abs(value - target) <= (max - min) * 0.04) {
        return target
    }
    return value
}

function placeThumb(input: HTMLInputElement) {
    const slider = input.closest('.slider, .seek, .mix-slider, .fx-slider, .br-slider, .chaos-slider, .chaos-small')
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
