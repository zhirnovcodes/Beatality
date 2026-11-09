// Host page for the skin. The processor owns the audio; this page only draws and sends edits.

const state = {
    bpm: 120,
    bpmSync: false,
    retrig: true,
    loopBeats: 8,
    sliceExp: 0,
    attackMs: 2,
    effectsEnabled: true,
    globalPower: 1,
    globalBeatMin: -3,
    globalBeatMax: -1,
    globalChance: 0,
    reverbPower: 1,
    reverbChance: 0,
    delayPower: 1,
    delayChance: 0,
    reversePower: 1,
    reverseChance: 0,
    filterPower: 1,
    filterChance: 0,
    flangerPower: 1,
    flangerChance: 0,
    trancePower: 1,
    tranceChance: 0,
    shiftPower: 1,
    shiftChance: 0,
    repeatEnabled: false,
    repeatSizeMin: 0,
    repeatSizeMax: 0,
    repeatLength: 0,
    repeatChance: 0,
    repeatPositions: [false, false, false, false, false, false, false, false],
    repeatMix: 1,
    playhead: 0,
    playTrack: -1,
    playSlot: -1,
    canAppend: true,
    outputVolume: 1,
    outputPanMin: 0,
    outputPanMax: 0,
    chaosTrigger: 4,
    chaosValue: 0,
    chaosBeatSize: 0,
    chaosLoopSize: 1,
    chaosSliceSize: 0,
    chaosGroups: Array(11).fill(false),
}

// Warp modes in the engine's order: the index is the mode number setWarp takes.
const warpModes = ['none', 'beat', 'pitch', 'grain']
// The BEAT slider's steps, in beats. Its index over the last index is the engine's warp param.
const beatSteps = ['1/32', '1/16', '1/8', '1/4', '1/2', '1', '2']
// In grain mode the same slider is continuous: its value over grainSteps is the engine's warp param.
const grainSteps = 100
// The engine's grain size for a warp param: 10 ms at 0, 200 ms at 1, on an exponential curve.
const grainMs = (param) => 10 * Math.pow(20, param)
// The sample BPM field accepts this range, one decimal place.
const bpmMin = 20
const bpmMax = 999

const plays = []
let pictures = { names: [], rates: [], frames: [], peaks: [] }
// Rows whose sample controls are on the page. The first is the one WARP steps from.
let selected = []
// The selection the SPLIT row was last reset for. Any other selection puts SPLIT back from SURE? / OK / CANCEL.
let splitSelection = ''
let epoch = -1
// Rows sent to the processor for removal, in the order sent: highest first.
let pendingRemove = []
let builtKey = ''
let bankOpen = false
let bankIndex = 0
let banks = []

const pending = new Map()
let nextId = 0

function native(name, ...args) {
    const backend = window.__JUCE__ && window.__JUCE__.backend
    if (!backend) {
        return Promise.reject(new Error('missing host'))
    }
    const resultId = nextId++
    const result = new Promise((resolve) => {
        pending.set(resultId, resolve)
    })
    backend.emitEvent('__juce__invoke', { name, params: args, resultId })
    return result
}

function clampBpm(value) {
    if (!Number.isFinite(value)) {
        return null
    }
    const bpm = Math.round(value)
    if (bpm < 1 || bpm > 999) {
        return null
    }
    return bpm
}

function fitSlice(exponent, beats) {
    let fitted = exponent
    while (2 ** fitted > beats) {
        fitted -= 1
    }
    return fitted
}

function sliceLabel(exponent) {
    if (exponent >= 0) {
        return String(2 ** exponent)
    }
    return '1/' + String(2 ** -exponent)
}

function columns() {
    return Math.max(1, Math.round(state.loopBeats / 2 ** state.sliceExp))
}

function placeThumb(input) {
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

function holdSnap(input) {
    const min = Number(input.min)
    const max = Number(input.max)
    let value = Number(input.value)
    const snap = input.dataset.snap
    if (snap != null && snap !== '') {
        const target = Number(snap)
        if (Number.isFinite(target) && Math.abs(value - target) <= (max - min) * 0.04) {
            value = target
            input.value = String(value)
        }
    }
    placeThumb(input)
    return value
}

function durationSec(index) {
    const rate = pictures.rates[index] || 0
    const frames = pictures.frames[index] || 0
    return rate > 0 && frames > 0 ? frames / rate : 0
}

// How much start moves when the wave moves one pixel, at the width drawWave paints the file. 0 when there is no sample.
function startPerPixel(index) {
    const play = plays[index]
    if (!play) {
        return 0
    }
    const bpm = play.bpm > 0 ? play.bpm : 120
    const pxPerBeat = 424 / Math.max(1, state.loopBeats)
    const imageWidth = durationSec(index) * (bpm / 60) * pxPerBeat
    return imageWidth > 0 ? 1 / imageWidth : 0
}

// Undefined hides the thumb: the selected rows differ.
function setRange(id, value) {
    const input = document.getElementById(id)
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    input.closest('.slider')?.classList.toggle('mixed', value === undefined)
    if (document.activeElement === input || value === undefined) {
        return
    }
    input.value = String(value)
    placeThumb(input)
}

// The value every selected row has, or undefined when they differ or none is selected.
function shared(read) {
    let value
    for (let at = 0; at < selected.length; at++) {
        const next = read(selected[at])
        if (next === undefined || (at > 0 && next !== value)) {
            return undefined
        }
        value = next
    }
    return value
}

function syncCaptions() {
    const loop = document.querySelector('[data-for="loop"] .value')
    const slice = document.querySelector('[data-for="slice"] .value')
    const attack = document.querySelector('[data-for="attack"] .value')
    if (loop) {
        loop.textContent = String(state.loopBeats)
    }
    if (slice) {
        slice.textContent = sliceLabel(state.sliceExp)
    }
    if (attack) {
        attack.textContent = String(state.attackMs)
    }
}

// SPLIT row: 'idle' shows SPLIT BY LOOP SIZE, 'confirm' shows SURE? with OK and CANCEL.
function setSplitState(value) {
    const row = document.getElementById('split-row')
    if (row) {
        row.dataset.state = value
    }
}

function syncButtons() {
    const has = plays.length > 0
    const selectAll = document.getElementById('select-all')
    if (selectAll instanceof HTMLButtonElement) {
        selectAll.disabled = bankOpen || !has
    }
    const split = document.getElementById('track-split')
    if (split instanceof HTMLButtonElement) {
        split.disabled = !state.canAppend
    }
    const append = document.getElementById('append')
    const remove = document.getElementById('remove')
    const clear = document.getElementById('clear')
    const load = document.getElementById('load-bank')
    const save = document.getElementById('save')
    if (append instanceof HTMLButtonElement) {
        append.disabled = bankOpen || !state.canAppend
    }
    if (remove instanceof HTMLButtonElement) {
        remove.disabled = bankOpen || !has
    }
    if (clear instanceof HTMLButtonElement) {
        clear.disabled = bankOpen || !has
    }
    if (load instanceof HTMLButtonElement) {
        load.disabled = bankOpen
    }
    if (save instanceof HTMLButtonElement) {
        save.disabled = bankOpen
    }
}

function drawWave(canvas, index) {
    const width = 424
    const height = 28
    const play = plays[index]
    const peaks = pictures.peaks[index] || []
    const rate = pictures.rates[index] || 0
    const frames = pictures.frames[index] || 0
    const ratio = window.devicePixelRatio || 1
    const deviceWidth = Math.max(1, Math.round(width * ratio))
    const deviceHeight = Math.max(1, Math.round(height * ratio))
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
        canvas.width = deviceWidth
        canvas.height = deviceHeight
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        return
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, deviceWidth, deviceHeight)
    if (!play || peaks.length === 0) {
        return
    }

    // The file is drawn at its own BPM, where every warp mode measures its slices. The project BPM does not move it.
    const bpm = play.bpm > 0 ? play.bpm : 120
    const beats = Math.max(1, state.loopBeats)
    const sliceBeats = 2 ** state.sliceExp
    const pxPerBeat = width / beats
    const gridWidth = sliceBeats * pxPerBeat
    const durationSec = rate > 0 && frames > 0 ? frames / rate : 0
    const imageWidth = durationSec * (bpm / 60) * pxPerBeat
    const imageStart = -play.start * imageWidth
    const sliceSec = (sliceBeats * 60) / bpm
    const usableSec = durationSec * (1 - play.start)
    const maxSlices = !(sliceSec > 0) ? 1 : Math.max(1, Math.floor(usableSec / sliceSec + 0.99))
    const length = Math.min(1, Math.max(0, play.length))
    const sliceCount = Math.round(length * (maxSlices - 1)) + 1
    const contentWidth = sliceCount * gridWidth
    const lead = Math.max(0, -imageStart)
    const audioAfter = Math.max(0, imageWidth - lead)
    const drawWidth = Math.min(Math.max(0, contentWidth), audioAfter)
    if (!(imageWidth > 0) || !(drawWidth > 0)) {
        return
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = '#c1fd31'
    let volume = play.volume
    if (!Number.isFinite(volume)) {
        volume = 1
    }
    if (volume < 0) {
        volume = 0
    } else if (volume > 1.2) {
        volume = 1.2
    }
    const mid = height * 0.5
    const half = mid * volume
    for (let x = 0; x < width; x++) {
        let into = x
        if (play.loop && contentWidth > 0) {
            into = x % contentWidth
            if (into < 0) {
                into += contentWidth
            }
        }
        if (into < 0 || into >= drawWidth) {
            continue
        }
        const column = Math.floor(((lead + into) / imageWidth) * peaks.length)
        if (column < 0 || column >= peaks.length) {
            continue
        }
        if (!(half > 0)) {
            continue
        }
        let bar = peaks[column] * half
        if (volume >= 1 && bar > 0 && bar < 0.5) {
            bar = 0.5
        }
        if (!(bar > 0)) {
            continue
        }
        const top = Math.max(0, mid - bar)
        const drawn = Math.min(height, mid + bar) - top
        ctx.fillRect(x, top, 1, drawn)
    }
}

function redrawWaves() {
    const rows = document.querySelectorAll('#sample-grid .row')
    rows.forEach((row, index) => {
        const canvas = row.querySelector('canvas')
        if (canvas instanceof HTMLCanvasElement) {
            drawWave(canvas, index)
        }
    })
}

function markRows() {
    const grid = document.getElementById('sample-grid')
    if (!grid) {
        return
    }
    const cols = columns()
    const rows = grid.children
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        row.setAttribute('aria-selected', selected.includes(index) ? 'true' : 'false')
        const playingCol = index === state.playTrack && state.playSlot >= 0 && state.playSlot < cols ? state.playSlot : -1
        const cells = row.querySelectorAll('.cell')
        for (let column = 0; column < cells.length; column++) {
            cells[column].classList.toggle('playing', column === playingCol)
        }
    }
}

function writeStartTime(seconds) {
    const input = document.getElementById('start-time')
    if (!(input instanceof HTMLInputElement) || document.activeElement === input) {
        return
    }
    if (seconds === undefined) {
        input.value = '--'
        return
    }
    const limit = Number(input.dataset.max)
    const capped = Number.isFinite(limit) ? Math.min(limit, Math.max(0, seconds)) : Math.max(0, seconds)
    const shown = capped.toFixed(2)
    if (input.value !== shown) {
        input.value = shown
    }
}

function syncPanel() {
    const panel = document.getElementById('selected-sample')
    if (panel instanceof HTMLFieldSetElement) {
        panel.disabled = selected.length === 0
    }
    const selection = selected.join(',')
    if (selection !== splitSelection) {
        splitSelection = selection
        setSplitState('idle')
    }
    syncWarpPanel()
    const duration = selected.length > 0 ? durationSec(selected[0]) : 0
    const startTime = document.getElementById('start-time')
    if (startTime instanceof HTMLInputElement) {
        const limit = duration > 0 ? duration : 0
        startTime.dataset.max = String(limit)
        startTime.max = String(limit)
    }
    const loop = document.getElementById('track-loop')
    if (selected.length === 0) {
        setRange('volume', 1)
        setRange('pan', 0)
        setRange('start', 0)
        setRange('length', 1)
        writeStartTime(0)
        if (loop instanceof HTMLInputElement && document.activeElement !== loop) {
            loop.indeterminate = false
            loop.checked = false
        }
        return
    }
    // A control whose value differs between the selected rows shows no value.
    setRange('volume', shared((index) => plays[index]?.volume))
    setRange('pan', shared((index) => plays[index]?.pan))
    setRange('start', shared((index) => plays[index]?.start))
    setRange('length', shared((index) => plays[index]?.length))
    const seconds = shared(startSeconds)
    writeStartTime(seconds === undefined ? undefined : Number(seconds))
    const looped = shared((index) => plays[index]?.loop)
    if (loop instanceof HTMLInputElement && document.activeElement !== loop) {
        loop.indeterminate = looped === undefined
        loop.checked = looped ?? false
    }
}

// Start of the row in seconds as the field shows it.
function startSeconds(index) {
    const play = plays[index]
    return play ? (play.start * durationSec(index)).toFixed(2) : undefined
}

// The file name, BPM, WARP, and BEAT of the selected samples. A field the user is typing in is left alone.
function syncWarpPanel() {
    const none = selected.length === 0
    const name = document.getElementById('track-name')
    if (name) {
        const text = none ? 'none selected' : selected.length > 1 ? 'multiple selected' : plays[selected[0]]?.name || ''
        name.textContent = text
        name.title = text
    }
    const warp = none ? 0 : shared((index) => plays[index]?.warp)
    const label = document.getElementById('track-warp')
    if (label) {
        label.dataset.value = warp === undefined ? 'none' : warpModes[warp] || 'none'
        label.textContent = warp === undefined ? '---' : (warpModes[warp] || 'none').toUpperCase()
    }
    const beat = document.getElementById('track-beat')
    if (beat instanceof HTMLInputElement) {
        // SIZE changes the sound only in beat and grain mode, so it is disabled unless every selected sample is in one of them.
        // Beat mode steps through beatSteps. Grain mode is continuous over grainSteps.
        const grain = warp === 3
        beat.disabled = warp !== 1 && !grain
        const last = grain ? grainSteps : beatSteps.length - 1
        beat.max = String(last)
        const step = none ? 0 : shared((index) => (plays[index] ? Math.round(plays[index].warpParam * last) : undefined))
        setRange('track-beat', step)
        placeThumb(beat)
        const caption = document.querySelector('.sample-panel .name.beat .value')
        if (caption) {
            const value = Number(beat.value)
            caption.textContent = step === undefined ? '--' : grain ? Math.round(grainMs(value / last)) + 'ms' : beatSteps[value] || ''
        }
    }
    const bpm = document.getElementById('track-bpm')
    if (bpm instanceof HTMLInputElement && document.activeElement !== bpm) {
        const value = none ? 120 : shared((index) => plays[index]?.bpm)
        bpm.value = value === undefined ? '--' : value.toFixed(1)
    }
}

function structureKey() {
    return columns() + '|' + plays.map((play) => (play.missing ? '!' : '') + play.name).join('\n')
}

function rebuildRows() {
    const grid = document.getElementById('sample-grid')
    if (!grid) {
        return
    }
    const cols = columns()
    const rows = []
    for (let index = 0; index < plays.length; index++) {
        const play = plays[index]
        const row = document.createElement('div')
        row.className = 'row'
        row.setAttribute('role', 'option')
        row.title = play.name
        const spectrum = document.createElement('div')
        spectrum.className = 'spectrum'
        const canvas = document.createElement('canvas')
        spectrum.append(canvas)
        if (play.missing) {
            const label = document.createElement('div')
            label.className = 'missing-label'
            label.textContent = 'error loading track'
            spectrum.append(label)
        }
        row.append(spectrum)
        for (let column = 0; column < cols; column++) {
            const cell = document.createElement('div')
            cell.className = 'cell'
            row.append(cell)
        }
        // Dragging the row grabs the wave. Left brings later audio in, so start goes up.
        // A selected row drags every selected row's wave by the same pixels.
        let downX = 0
        let downStarts = new Map()
        let dragging = false
        // Shift toggles the row in and out of the selection. A drag does not select.
        row.addEventListener('click', (event) => {
            if (dragging) {
                return
            }
            if (!event.shiftKey) {
                selected = [index]
            } else if (selected.includes(index)) {
                selected = selected.filter((at) => at !== index)
            } else {
                selected = [...selected, index]
            }
            markRows()
            syncPanel()
        })
        row.addEventListener('pointerdown', (event) => {
            if (!plays[index] || event.button !== 0) {
                return
            }
            row.setPointerCapture(event.pointerId)
            downX = event.clientX
            const moved = selected.includes(index) ? selected : [index]
            downStarts = new Map(moved.filter((at) => plays[at]).map((at) => [at, plays[at].start]))
            dragging = false
        })
        row.addEventListener('pointermove', (event) => {
            if (!row.hasPointerCapture(event.pointerId)) {
                return
            }
            const dx = event.clientX - downX
            if (!dragging && Math.abs(dx) < 3) {
                return
            }
            dragging = true
            const canvases = document.querySelectorAll('#sample-grid .row canvas')
            for (const [at, start] of downStarts) {
                const dragged = plays[at]
                const perPixel = startPerPixel(at)
                if (!dragged || !(perPixel > 0)) {
                    continue
                }
                dragged.start = Math.min(1, Math.max(0, start - dx * perPixel))
                if (canvases[at] instanceof HTMLCanvasElement) {
                    drawWave(canvases[at], at)
                }
                void native('setTrack', at, dragged.start, dragged.length, dragged.loop, dragged.volume, dragged.pan)
            }
            if (selected.includes(index)) {
                syncPanel()
            }
        })
        const release = (event) => {
            if (row.hasPointerCapture(event.pointerId)) {
                row.releasePointerCapture(event.pointerId)
            }
        }
        row.addEventListener('pointerup', release)
        row.addEventListener('pointercancel', release)
        rows.push(row)
    }
    grid.replaceChildren(...rows)
    redrawWaves()
}

function paintGrid() {
    const key = structureKey()
    if (key !== builtKey) {
        builtKey = key
        rebuildRows()
    } else {
        redrawWaves()
    }
    markRows()
    syncPanel()
    syncButtons()
}

// A new file takes the project tempo as its own. The processor does the same.
function freshPlay(name) {
    const bpm = state.bpm > 0 ? state.bpm : 120
    return { name, start: 0, length: 1, loop: false, volume: 1, pan: 0, warp: 0, bpm, warpParam: 0, missing: false }
}

function playFromBank(name, bank, index) {
    const at = (list, fallback) => {
        const value = list && list[index]
        const number = Number(value)
        return value == null || !Number.isFinite(number) ? fallback : number
    }
    return {
        name,
        start: at(bank.starts, 0),
        length: at(bank.lengths, 1),
        loop: !!(bank.loops && bank.loops[index]),
        volume: at(bank.volumes, 1),
        pan: at(bank.pans, 0),
        warp: at(bank.warps, 0),
        bpm: at(bank.bpms, 120),
        warpParam: at(bank.warpParams, 0),
        missing: !!(bank.missing && bank.missing[index]),
    }
}

function replacePlays(names) {
    plays.splice(0, plays.length, ...names.map(freshPlay))
    selected = []
}

function onBank(bank) {
    const names = bank.names || []
    if (bank.epoch !== epoch) {
        epoch = bank.epoch
        pendingRemove = []
        plays.splice(0, plays.length, ...names.map((name, index) => playFromBank(name, bank, index)))
        selected = []
        applyBankSettings(bank)
    } else if (pendingRemove.length > 0 && names.length === plays.length - 1) {
        // Rows after the removed one move up.
        const index = pendingRemove.shift()
        plays.splice(index, 1)
        selected = selected.filter((at) => at !== index).map((at) => (at > index ? at - 1 : at))
    } else if (names.length >= plays.length && plays.every((play, index) => play.name === names[index])) {
        pendingRemove = []
        for (let index = plays.length; index < names.length; index++) {
            plays.push(playFromBank(names[index], bank, index))
        }
    } else {
        pendingRemove = []
        replacePlays(names)
    }
    pictures = {
        names,
        rates: bank.rates || [],
        frames: bank.frames || [],
        peaks: bank.peaks || [],
    }
    paintGrid()
}

function onLive(live) {
    const playhead = Number(live.playhead)
    state.playhead = Number.isFinite(playhead) ? Math.min(1, Math.max(0, playhead)) : 0
    state.playTrack = Number(live.playTrack)
    state.playSlot = Number(live.playSlot)
    state.canAppend = !!live.canAppend
    setRange('playhead', state.playhead)
    const error = document.getElementById('error')
    if (error) {
        error.textContent = live.error || ''
    }
    followHost(live)
    syncButtons()
    markRows()
}

// Loop, slices, volume, pan, the effects, and the beat repeat knobs are host parameters, so the host's automation can move them.
// A control the mouse is holding keeps the mouse's value.
function followHost(live) {
    const free = (id) => {
        const input = document.getElementById(id)
        return input instanceof HTMLInputElement && !input.matches(':active') ? input : null
    }
    const show = (input, value) => {
        input.value = String(value)
        placeThumb(input)
    }
    let gridChanged = false
    const loop = Number(live.loop)
    const loopInput = free('loop')
    if (loopInput && Number.isInteger(loop) && loop !== state.loopBeats) {
        state.loopBeats = loop
        show(loopInput, loop)
        gridChanged = true
    }
    const slices = Number(live.slices)
    const sliceInput = free('slice')
    if (sliceInput && Number.isInteger(slices)) {
        const fitted = fitSlice(slices, state.loopBeats)
        if (fitted !== state.sliceExp) {
            state.sliceExp = fitted
            show(sliceInput, fitted)
            gridChanged = true
        }
    }
    if (gridChanged) {
        syncCaptions()
        paintGrid()
    }
    const volume = Number(live.volume)
    const volumeInput = free('master-volume')
    if (volumeInput && Number.isFinite(volume) && volume !== state.outputVolume) {
        state.outputVolume = volume
        show(volumeInput, volume)
    }
    const panMin = Number(live.panMin)
    const panMax = Number(live.panMax)
    if (free('master-pan-min') && free('master-pan-max') && Number.isFinite(panMin) && Number.isFinite(panMax) &&
        (panMin !== state.outputPanMin || panMax !== state.outputPanMax)) {
        state.outputPanMin = panMin
        state.outputPanMax = Math.max(panMin, panMax)
        paintMasterPan()
    }

    if (live.retrig != null && Boolean(live.retrig) !== state.retrig) {
        state.retrig = Boolean(live.retrig)
        paintRetrig()
    }
    if (live.effectsEnabled != null && Boolean(live.effectsEnabled) !== state.effectsEnabled) {
        state.effectsEnabled = Boolean(live.effectsEnabled)
        paintEffectsEnabled()
    }
    for (const [key, id] of effectSliders) {
        const value = Number(live[key])
        if (free(id) && Number.isFinite(value) && value !== state[key]) {
            state[key] = value
            setRange(id, value)
        }
    }
    const beatMin = Number(live.globalBeatMin)
    const beatMax = Number(live.globalBeatMax)
    if (free('fx-time-min') && free('fx-time-max') && Number.isInteger(beatMin) && Number.isInteger(beatMax) &&
        (beatMin !== state.globalBeatMin || beatMax !== state.globalBeatMax)) {
        state.globalBeatMin = beatMin
        state.globalBeatMax = beatMax
        paintEffectTime()
    }

    let repeatChanged = false
    if (live.repeatEnabled != null && Boolean(live.repeatEnabled) !== state.repeatEnabled) {
        state.repeatEnabled = Boolean(live.repeatEnabled)
        repeatChanged = true
    }
    const sizeMin = Number(live.repeatSizeMin)
    const sizeMax = Number(live.repeatSizeMax)
    if (free('br-size-min') && free('br-size-max') && Number.isInteger(sizeMin) && Number.isInteger(sizeMax) &&
        (sizeMin !== state.repeatSizeMin || sizeMax !== state.repeatSizeMax)) {
        state.repeatSizeMin = sizeMin
        state.repeatSizeMax = sizeMax
        repeatChanged = true
    }
    const length = Number(live.repeatLength)
    if (free('br-length') && Number.isInteger(length) && length !== state.repeatLength) {
        state.repeatLength = length
        repeatChanged = true
    }
    for (const [key, id] of [['repeatChance', 'br-chance'], ['repeatMix', 'br-mix']]) {
        const value = Number(live[key])
        if (free(id) && Number.isFinite(value) && value !== state[key]) {
            state[key] = value
            repeatChanged = true
        }
    }
    const positions = live.repeatPositions
    if (Array.isArray(positions) && positions.some((on, index) => Boolean(on) !== state.repeatPositions[index])) {
        state.repeatPositions = positions.map(Boolean)
        repeatChanged = true
    }
    if (repeatChanged) {
        paintBeatRepeat()
    }

    // Attack and the loop parts are not host parameters, but the engine can move them.
    const attack = Number(live.attack)
    if (free('attack') && Number.isInteger(attack) && attack !== state.attackMs) {
        state.attackMs = attack
        setRange('attack', attack)
        syncCaptions()
    }
    followChaos(live)
}

// The CHAOS side panels. The page only shows the values and sends edits.
// Triggers in bt::ChaosTrigger order. Loop, Slices and Beats each have a size slider; only the chosen one shows.
const chaosTriggerNames = ['NOTE', 'LOOP', 'SLICES', 'BEAT', 'NONE']
// Trigger number: the size slider's input id, state key, setter, caption.
// Beats size is 2^n beats, slices size is 2^n slices.
const chaosSizes = {
    1: ['chaos-loop-size', 'chaosLoopSize', 'setChaosLoopSize', (value) => 'LOOPS (' + value + ')'],
    2: ['chaos-slice-size', 'chaosSliceSize', 'setChaosSliceSize', (value) => 'SLICES (' + sliceLabel(value) + ')'],
    3: ['chaos-beat-size', 'chaosBeatSize', 'setChaosBeatSize', (value) => 'BEATS (' + sliceLabel(value) + ')'],
}

function paintChaosRange(id, value) {
    const input = document.getElementById(id)
    if (input instanceof HTMLInputElement && !input.matches(':active')) {
        input.value = String(value)
        placeThumb(input)
    }
}

function paintChaos() {
    const trigger = document.getElementById('chaos-trigger')
    if (trigger) {
        trigger.textContent = chaosTriggerNames[state.chaosTrigger] ?? ''
    }
    paintChaosRange('chaos-value', state.chaosValue)
    for (const [id, key] of Object.values(chaosSizes)) {
        paintChaosRange(id, state[key])
    }
    document.querySelectorAll('.chaos-small').forEach((slider) => {
        slider.classList.toggle('on', Number(slider.dataset.trigger) === state.chaosTrigger)
    })
    const size = chaosSizes[state.chaosTrigger]
    const caption = document.getElementById('chaos-size-cap')
    if (caption) {
        caption.style.visibility = size ? 'visible' : 'hidden'
        caption.textContent = size ? size[3](state[size[1]]) : ''
    }
    document.querySelectorAll('.chaos-group').forEach((box) => {
        if (box instanceof HTMLInputElement) {
            box.checked = state.chaosGroups[Number(box.dataset.group)]
        }
    })
}

function followChaos(live) {
    let changed = false
    for (const key of ['chaosTrigger', 'chaosValue', 'chaosBeatSize', 'chaosLoopSize', 'chaosSliceSize']) {
        const value = Number(live[key])
        if (Number.isFinite(value) && value !== state[key]) {
            state[key] = value
            changed = true
        }
    }
    const groups = live.chaosGroups
    if (Array.isArray(groups) && groups.some((on, index) => Boolean(on) !== state.chaosGroups[index])) {
        state.chaosGroups = groups.map(Boolean)
        changed = true
    }
    if (changed) {
        paintChaos()
    }
}

function stepChaosTrigger(step) {
    const count = chaosTriggerNames.length
    state.chaosTrigger = (state.chaosTrigger + step + count) % count
    paintChaos()
    void native('setChaosTrigger', state.chaosTrigger)
}

function wireChaos() {
    // Each drawer's button only slides it out or back: CHAOS, BEAT REPEAT, SAMPLE SETTINGS.
    for (const [drawerId, buttonId] of [['chaos-drawer', 'side-chaos'], ['br-drawer', 'side-beatrepeat'], ['ss-drawer', 'side-samples']]) {
        const drawer = document.getElementById(drawerId)
        const button = document.getElementById(buttonId)
        button?.addEventListener('click', () => {
            const open = !drawer?.classList.contains('open')
            drawer?.classList.toggle('open', open)
            button.setAttribute('aria-expanded', String(open))
        })
    }
    document.getElementById('chaos-trigger-prev')?.addEventListener('click', () => stepChaosTrigger(-1))
    document.getElementById('chaos-trigger-next')?.addEventListener('click', () => stepChaosTrigger(1))
    const ranges = [['chaos-value', 'chaosValue', 'setChaosValue'], ...Object.values(chaosSizes)]
    for (const [id, key, name] of ranges) {
        document.getElementById(id)?.addEventListener('input', (event) => {
            const value = Number(event.currentTarget.value)
            placeThumb(event.currentTarget)
            if (value === state[key]) {
                return
            }
            state[key] = value
            paintChaos()
            void native(name, value)
        })
    }
    document.querySelectorAll('.chaos-group').forEach((box) => {
        box.addEventListener('change', () => {
            const group = Number(box.dataset.group)
            state.chaosGroups[group] = box.checked
            void native('setChaosGroup', group, box.checked)
        })
    })
    paintChaos()
}

// The effect sliders that host parameters move: state key, input id.
const effectSliders = [
    ['globalPower', 'fx-power'],
    ['globalChance', 'fx-chance'],
    ['delayPower', 'fx-delay-power'],
    ['delayChance', 'fx-delay-chance'],
    ['reverbPower', 'fx-reverb-power'],
    ['reverbChance', 'fx-reverb-chance'],
    ['reversePower', 'fx-reverse-power'],
    ['reverseChance', 'fx-reverse-chance'],
    ['filterPower', 'fx-filter-power'],
    ['filterChance', 'fx-filter-chance'],
    ['flangerPower', 'fx-flanger-power'],
    ['flangerChance', 'fx-flanger-chance'],
    ['trancePower', 'fx-trance-power'],
    ['tranceChance', 'fx-trance-chance'],
    ['shiftPower', 'fx-shift-power'],
    ['shiftChance', 'fx-shift-chance'],
]

function applyBankSettings(bank) {
    if (bank.bpm == null) {
        return
    }
    const bpm = clampBpm(Number(bank.bpm))
    if (bpm !== null) {
        state.bpm = bpm
    }
    if (bank.bpmSync != null) {
        state.bpmSync = Boolean(bank.bpmSync)
    }
    if (bank.retrig != null) {
        state.retrig = Boolean(bank.retrig)
    }
    paintRetrig()
    paintBpm()
    const loop = Number(bank.loop)
    const slices = Number(bank.slices)
    const attack = Number(bank.attack)
    if (Number.isInteger(loop)) {
        state.loopBeats = loop
        setRange('loop', loop)
    }
    if (Number.isInteger(slices)) {
        state.sliceExp = fitSlice(slices, state.loopBeats)
        setRange('slice', state.sliceExp)
    }
    if (Number.isInteger(attack)) {
        state.attackMs = attack
        setRange('attack', attack)
    }
    if (bank.effectsEnabled != null) {
        state.effectsEnabled = Boolean(bank.effectsEnabled)
        paintEffectsEnabled()
    }
    if (bank.globalPower != null && Number.isFinite(Number(bank.globalPower))) {
        state.globalPower = Number(bank.globalPower)
        setRange('fx-power', state.globalPower)
    }
    if (Number.isInteger(Number(bank.globalBeatMin)) && Number.isInteger(Number(bank.globalBeatMax))) {
        state.globalBeatMin = Number(bank.globalBeatMin)
        state.globalBeatMax = Number(bank.globalBeatMax)
        paintEffectTime()
    }
    if (bank.globalChance != null && Number.isFinite(Number(bank.globalChance))) {
        state.globalChance = Number(bank.globalChance)
        setRange('fx-chance', state.globalChance)
    }
    if (bank.reverbPower != null && Number.isFinite(Number(bank.reverbPower))) {
        state.reverbPower = Number(bank.reverbPower)
        setRange('fx-reverb-power', state.reverbPower)
    }
    if (bank.reverbChance != null && Number.isFinite(Number(bank.reverbChance))) {
        state.reverbChance = Number(bank.reverbChance)
        setRange('fx-reverb-chance', state.reverbChance)
    }
    if (bank.delayPower != null && Number.isFinite(Number(bank.delayPower))) {
        state.delayPower = Number(bank.delayPower)
        setRange('fx-delay-power', state.delayPower)
    }
    if (bank.delayChance != null && Number.isFinite(Number(bank.delayChance))) {
        state.delayChance = Number(bank.delayChance)
        setRange('fx-delay-chance', state.delayChance)
    }
    if (bank.reversePower != null && Number.isFinite(Number(bank.reversePower))) {
        state.reversePower = Number(bank.reversePower)
        setRange('fx-reverse-power', state.reversePower)
    }
    if (bank.reverseChance != null && Number.isFinite(Number(bank.reverseChance))) {
        state.reverseChance = Number(bank.reverseChance)
        setRange('fx-reverse-chance', state.reverseChance)
    }
    if (bank.filterPower != null && Number.isFinite(Number(bank.filterPower))) {
        state.filterPower = Number(bank.filterPower)
        setRange('fx-filter-power', state.filterPower)
    }
    if (bank.filterChance != null && Number.isFinite(Number(bank.filterChance))) {
        state.filterChance = Number(bank.filterChance)
        setRange('fx-filter-chance', state.filterChance)
    }
    if (bank.flangerPower != null && Number.isFinite(Number(bank.flangerPower))) {
        state.flangerPower = Number(bank.flangerPower)
        setRange('fx-flanger-power', state.flangerPower)
    }
    if (bank.flangerChance != null && Number.isFinite(Number(bank.flangerChance))) {
        state.flangerChance = Number(bank.flangerChance)
        setRange('fx-flanger-chance', state.flangerChance)
    }
    if (bank.trancePower != null && Number.isFinite(Number(bank.trancePower))) {
        state.trancePower = Number(bank.trancePower)
        setRange('fx-trance-power', state.trancePower)
    }
    if (bank.tranceChance != null && Number.isFinite(Number(bank.tranceChance))) {
        state.tranceChance = Number(bank.tranceChance)
        setRange('fx-trance-chance', state.tranceChance)
    }
    if (bank.shiftPower != null && Number.isFinite(Number(bank.shiftPower))) {
        state.shiftPower = Number(bank.shiftPower)
        setRange('fx-shift-power', state.shiftPower)
    }
    if (bank.shiftChance != null && Number.isFinite(Number(bank.shiftChance))) {
        state.shiftChance = Number(bank.shiftChance)
        setRange('fx-shift-chance', state.shiftChance)
    }
    if (bank.repeatEnabled != null) {
        state.repeatEnabled = Boolean(bank.repeatEnabled)
    }
    if (Number.isInteger(Number(bank.repeatSizeMin)) && Number.isInteger(Number(bank.repeatSizeMax))) {
        state.repeatSizeMin = Number(bank.repeatSizeMin)
        state.repeatSizeMax = Number(bank.repeatSizeMax)
    }
    if (Number.isInteger(Number(bank.repeatLength))) {
        state.repeatLength = Number(bank.repeatLength)
    }
    if (bank.repeatChance != null && Number.isFinite(Number(bank.repeatChance))) {
        state.repeatChance = Number(bank.repeatChance)
    }
    if (Array.isArray(bank.repeatPositions)) {
        state.repeatPositions = state.repeatPositions.map((on, index) => Boolean(bank.repeatPositions[index]))
    }
    if (bank.repeatMix != null && Number.isFinite(Number(bank.repeatMix))) {
        state.repeatMix = Number(bank.repeatMix)
    }
    paintBeatRepeat()
    const volume = Number(bank.volume)
    const panMin = Number(bank.panMin)
    const panMax = Number(bank.panMax)
    if (Number.isFinite(volume)) {
        state.outputVolume = volume
        setRange('master-volume', volume)
    }
    if (Number.isFinite(panMin) && Number.isFinite(panMax)) {
        state.outputPanMin = panMin
        state.outputPanMax = panMax
        paintMasterPan()
    }
    syncCaptions()
}

function paintBankList() {
    const list = document.getElementById('bank-list')
    if (!list) {
        return
    }
    list.replaceChildren()
    banks.forEach((bank, index) => {
        const row = document.createElement('li')
        row.setAttribute('role', 'option')
        row.setAttribute('aria-selected', index === bankIndex ? 'true' : 'false')
        row.textContent = String(index + 1) + '. ' + bank.name
        row.addEventListener('click', () => {
            bankIndex = index
            paintBankList()
        })
        list.append(row)
    })
}

function setBankOpen(open) {
    bankOpen = open
    document.querySelector('.beatality-skin')?.classList.toggle('picking-bank', open)
    if (open) {
        paintBankList()
        const viewport = document.getElementById('sample-viewport')
        if (viewport) {
            viewport.scrollTop = 0
        }
    }
    syncButtons()
}

function commitTrack() {
    for (const index of selected) {
        const play = plays[index]
        if (play) {
            void native('setTrack', index, play.start, play.length, play.loop, play.volume, play.pan)
        }
    }
}

function commitWarp() {
    for (const index of selected) {
        const play = plays[index]
        if (play) {
            void native('setWarp', index, play.warp, play.bpm, play.warpParam)
        }
    }
}

// BEAT and the sample BPM, for every selected sample. The waveform is drawn at the sample BPM, so a new BPM redraws it.
function onWarp(event) {
    const input = event.currentTarget
    if (selected.length === 0 || !(input instanceof HTMLInputElement)) {
        return
    }
    if (input.id === 'track-beat') {
        // The slider's value over its max is the engine param: an index into beatSteps, or a grain size step.
        placeThumb(input)
        for (const index of selected) {
            if (plays[index]) {
                plays[index].warpParam = Number(input.value) / Number(input.max)
            }
        }
        syncWarpPanel()
    } else if (input.id === 'track-bpm') {
        const parsed = Number.parseFloat(input.value.trim().replace(',', '.'))
        const bpm = Number.isFinite(parsed) ? Math.min(bpmMax, Math.max(bpmMin, Math.round(parsed * 10) / 10)) : shared((index) => plays[index]?.bpm)
        input.value = bpm === undefined ? '--' : bpm.toFixed(1)
        if (bpm === undefined) {
            return
        }
        for (const index of selected) {
            if (plays[index]) {
                plays[index].bpm = bpm
            }
        }
        redrawWaves()
    }
    commitWarp()
}

// Steps WARP through none → beat → pitch → grain, wrapping, from the first selected sample's mode.
// Every selected sample takes the new mode.
function stepWarp(delta) {
    const first = plays[selected[0]]
    if (!first) {
        return
    }
    const warp = (first.warp + delta + warpModes.length) % warpModes.length
    for (const index of selected) {
        if (plays[index]) {
            plays[index].warp = warp
        }
    }
    syncWarpPanel()
    commitWarp()
}

function attachSampleScroll() {
    const bar = document.querySelector('.scrollbar')
    const viewport = document.querySelector('.viewport')
    if (!(bar instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
        return
    }
    const thumb = bar.querySelector('.thumb')
    const part = bar.closest('.part')
    const up = part && part.querySelector('.scroll-arrow.up')
    const down = part && part.querySelector('.scroll-arrow.down')
    if (!(thumb instanceof HTMLElement)) {
        return
    }

    const step = 16
    const travel = () => bar.clientHeight - thumb.offsetHeight
    const maxScroll = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const sync = () => {
        const max = maxScroll()
        thumb.style.top = (max ? viewport.scrollTop / max : 0) * travel() + 'px'
    }
    viewport.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(viewport)
    const content = viewport.querySelector('.scroll-content')
    if (content) {
        observer.observe(content)
    }
    sync()

    let startY = 0
    let startTop = 0
    thumb.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        thumb.setPointerCapture(event.pointerId)
        thumb.classList.add('dragging')
        startY = event.clientY
        startTop = viewport.scrollTop
    })
    thumb.addEventListener('pointermove', (event) => {
        if (!thumb.hasPointerCapture(event.pointerId)) {
            return
        }
        const room = travel()
        viewport.scrollTop = startTop + (event.clientY - startY) * (room ? maxScroll() / room : 0)
    })
    const endDrag = () => thumb.classList.remove('dragging')
    thumb.addEventListener('pointerup', endDrag)
    thumb.addEventListener('pointercancel', endDrag)
    bar.addEventListener('pointerdown', (event) => {
        if (event.target !== bar) {
            return
        }
        const above = event.clientY < thumb.getBoundingClientRect().top
        viewport.scrollBy({ top: (above ? -1 : 1) * viewport.clientHeight, behavior: 'smooth' })
    })
    bar.addEventListener('wheel', (event) => {
        event.preventDefault()
        viewport.scrollTop += event.deltaY
    }, { passive: false })

    for (const [button, dy] of [[up, -step], [down, step]]) {
        if (!(button instanceof HTMLElement)) {
            continue
        }
        let delay = 0
        let timer = 0
        const stop = () => {
            window.clearTimeout(delay)
            window.clearInterval(timer)
        }
        button.addEventListener('pointerdown', (event) => {
            event.preventDefault()
            viewport.scrollTop += dy
            delay = window.setTimeout(() => {
                timer = window.setInterval(() => {
                    viewport.scrollTop += dy
                }, 50)
            }, 300)
        })
        for (const name of ['pointerup', 'pointerleave', 'pointercancel']) {
            button.addEventListener(name, stop)
        }
    }
}

// Effect TIME. Both ends are exponents -4..1 (1/16 .. 2 beats). min is not above max.
function paintEffectTime() {
    const range = document.querySelector('.fx-slider.time')
    if (range instanceof HTMLElement) {
        range.style.setProperty('--lo', String((state.globalBeatMin + 4) / 5))
        range.style.setProperty('--hi', String((state.globalBeatMax + 4) / 5))
    }
    const min = document.getElementById('fx-time-min')
    const max = document.getElementById('fx-time-max')
    if (min instanceof HTMLInputElement && max instanceof HTMLInputElement) {
        min.value = String(state.globalBeatMin)
        max.value = String(state.globalBeatMax)
        min.setAttribute('aria-valuetext', sliceLabel(state.globalBeatMin) + ' beat')
        max.setAttribute('aria-valuetext', sliceLabel(state.globalBeatMax) + ' beat')
    }
}

function paintSliders() {
    document.querySelectorAll('.slider input, .mix-slider input, .fx-slider input, .br-slider input').forEach((input) => {
        if (input instanceof HTMLInputElement) {
            placeThumb(input)
        }
    })
    setRange('playhead', 0)
    paintEffectTime()
    paintEffectsEnabled()
    paintBeatRepeat()
    syncCaptions()
}

function paintEffectsEnabled() {
    const enable = document.getElementById('fx-enable')
    if (enable) {
        enable.setAttribute('aria-pressed', state.effectsEnabled ? 'true' : 'false')
        enable.textContent = state.effectsEnabled ? 'EFFECTS ON' : 'EFFECTS OFF'
    }
}

function onEffectsEnabled() {
    state.effectsEnabled = !state.effectsEnabled
    paintEffectsEnabled()
    void native('setEffectsEnabled', state.effectsEnabled)
}

function wire() {
    paintSliders()
    const backend = window.__JUCE__ && window.__JUCE__.backend
    if (!backend) {
        const error = document.getElementById('error')
        if (error) {
            error.textContent = 'This window could not reach the plugin.'
        }
        return
    }
    backend.addEventListener('__juce__complete', (event) => {
        const resolve = pending.get(event.promiseId)
        if (!resolve) {
            return
        }
        pending.delete(event.promiseId)
        resolve(event.result)
    })

    window.beatality = { onBank, onLive }
    wireChaos()

    document.querySelector('.bpm-btn.plus')?.addEventListener('click', () => bumpBpm(1))
    document.querySelector('.bpm-btn.minus')?.addEventListener('click', () => bumpBpm(-1))
    document.getElementById('bpm')?.addEventListener('input', commitBpm)
    document.getElementById('bpm')?.addEventListener('blur', paintBpm)
    document.getElementById('bpm-sync')?.addEventListener('click', onBpmSync)
    document.getElementById('retrig')?.addEventListener('click', onRetrig)

    document.getElementById('loop')?.addEventListener('input', onLoop)
    document.getElementById('slice')?.addEventListener('input', onSlice)
    document.getElementById('attack')?.addEventListener('input', onAttack)
    document.querySelector('.fx-sliders')?.addEventListener('input', (event) => {
        const input = event.target
        if (!(input instanceof HTMLInputElement)) {
            return
        }
        placeThumb(input)
    })
    document.getElementById('fx-power')?.addEventListener('input', onGlobalPower)
    document.getElementById('fx-time-min')?.addEventListener('input', onGlobalBeat)
    document.getElementById('fx-time-max')?.addEventListener('input', onGlobalBeat)
    document.getElementById('fx-chance')?.addEventListener('input', onGlobalChance)
    document.getElementById('fx-reverb-power')?.addEventListener('input', onReverbPower)
    document.getElementById('fx-reverb-chance')?.addEventListener('input', onReverbChance)
    document.getElementById('fx-delay-power')?.addEventListener('input', onDelayPower)
    document.getElementById('fx-delay-chance')?.addEventListener('input', onDelayChance)
    document.getElementById('fx-reverse-power')?.addEventListener('input', onReversePower)
    document.getElementById('fx-reverse-chance')?.addEventListener('input', onReverseChance)
    document.getElementById('fx-filter-power')?.addEventListener('input', onFilterPower)
    document.getElementById('fx-filter-chance')?.addEventListener('input', onFilterChance)
    document.getElementById('fx-flanger-power')?.addEventListener('input', onFlangerPower)
    document.getElementById('fx-flanger-chance')?.addEventListener('input', onFlangerChance)
    document.getElementById('fx-trance-power')?.addEventListener('input', onTrancePower)
    document.getElementById('fx-trance-chance')?.addEventListener('input', onTranceChance)
    document.getElementById('fx-shift-power')?.addEventListener('input', onShiftPower)
    document.getElementById('fx-shift-chance')?.addEventListener('input', onShiftChance)
    document.getElementById('fx-enable')?.addEventListener('click', onEffectsEnabled)
    document.getElementById('fx-shuffle')?.addEventListener('click', () => void native('shuffle'))

    document.getElementById('br-power')?.addEventListener('click', onRepeatPower)
    document.querySelectorAll('.br-part').forEach((box) => box.addEventListener('change', onRepeatPosition))
    document.getElementById('br-size-min')?.addEventListener('input', onRepeatSize)
    document.getElementById('br-size-max')?.addEventListener('input', onRepeatSize)
    document.getElementById('br-length')?.addEventListener('input', onRepeatLength)
    document.getElementById('br-chance')?.addEventListener('input', onRepeatChance)
    document.getElementById('br-mix')?.addEventListener('input', onRepeatMix)

    document.getElementById('master-volume')?.addEventListener('input', onMaster)
    document.getElementById('master-pan-min')?.addEventListener('input', onMasterPan)
    document.getElementById('master-pan-max')?.addEventListener('input', onMasterPan)
    document.getElementById('volume')?.addEventListener('input', onGain)
    document.getElementById('pan')?.addEventListener('input', onGain)

    const start = document.getElementById('start')
    const length = document.getElementById('length')
    start?.addEventListener('input', onRegion)
    length?.addEventListener('input', onRegion)
    const startTime = document.getElementById('start-time')
    startTime?.addEventListener('change', commitStartTime)
    startTime?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && startTime instanceof HTMLInputElement) {
            startTime.blur()
        }
    })
    document.getElementById('warp-prev')?.addEventListener('click', () => stepWarp(-1))
    document.getElementById('warp-next')?.addEventListener('click', () => stepWarp(1))
    document.getElementById('track-beat')?.addEventListener('input', onWarp)
    const trackBpm = document.getElementById('track-bpm')
    trackBpm?.addEventListener('change', onWarp)
    trackBpm?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && trackBpm instanceof HTMLInputElement) {
            trackBpm.blur()
        }
    })
    document.getElementById('track-loop')?.addEventListener('change', () => {
        const loop = document.getElementById('track-loop')
        if (!(loop instanceof HTMLInputElement)) {
            return
        }
        for (const index of selected) {
            if (plays[index]) {
                plays[index].loop = loop.checked
            }
        }
        redrawWaves()
        commitTrack()
    })

    document.getElementById('append')?.addEventListener('click', () => {
        void native('append')
    })
    document.getElementById('remove')?.addEventListener('click', () => {
        if (plays.length === 0) {
            return
        }
        // Highest first, so each index still names its row when the processor reaches it.
        pendingRemove = selected.length === 0 ? [0] : [...selected].sort((a, b) => b - a)
        for (const index of pendingRemove) {
            void native('remove', index)
        }
    })
    document.getElementById('clear')?.addEventListener('click', () => {
        if (plays.length === 0) {
            return
        }
        void native('clear')
    })
    document.getElementById('select-all')?.addEventListener('click', () => {
        selected = plays.map((_, index) => index)
        markRows()
        syncPanel()
    })
    // SPLIT asks SURE? first. OK splits every selected sample, from its start to the end of the file, into LOOP-long pieces.
    // The sample itself is the first piece and stays as it is; the later pieces are added at the end of the bank.
    document.getElementById('track-split')?.addEventListener('click', () => {
        if (selected.length > 0) {
            setSplitState('confirm')
        }
    })
    document.getElementById('split-ok')?.addEventListener('click', () => {
        setSplitState('idle')
        if (selected.length > 0) {
            void native('split', [...selected].sort((a, b) => a - b))
        }
    })
    document.getElementById('split-cancel')?.addEventListener('click', () => {
        setSplitState('idle')
    })
    document.getElementById('load-bank')?.addEventListener('click', () => {
        if (bankOpen) {
            return
        }
        bankIndex = 0
        setBankOpen(true)
    })
    document.getElementById('save')?.addEventListener('click', () => {
        if (bankOpen) {
            return
        }
        void native('savePack')
    })
    document.getElementById('bank-select')?.addEventListener('click', () => {
        const bank = banks[bankIndex]
        const button = document.getElementById('bank-select')
        if (!bank || !(button instanceof HTMLButtonElement) || button.disabled) {
            return
        }
        button.disabled = true
        void native('loadFactory', bank.file).finally(() => {
            button.disabled = banks.length === 0
            setBankOpen(false)
        })
    })
    document.getElementById('bank-load-file')?.addEventListener('click', () => {
        void native('loadPackFile').then((ok) => {
            if (ok) {
                setBankOpen(false)
            }
        })
    })
    document.getElementById('bank-close')?.addEventListener('click', () => {
        setBankOpen(false)
    })
    // Always enabled. With no samples the processor does nothing.
    document.getElementById('randomize')?.addEventListener('click', () => {
        void native('randomize')
    })
    // The CHAOS button: one chaos roll in every trigger mode.
    document.getElementById('chaos-main')?.addEventListener('click', () => {
        void native('chaos')
    })

    attachSampleScroll()
    void native('banks').then((list) => {
        banks = Array.isArray(list) ? list : []
    })
    void native('ready')
}

// Synced, the digits read 5YN (a 7-segment 5 stands in for the S), and the field and + / - do nothing.
function paintBpm() {
    const input = document.getElementById('bpm')
    if (input instanceof HTMLInputElement) {
        input.value = state.bpmSync ? '5YN' : String(state.bpm)
        input.readOnly = state.bpmSync
        input.setAttribute('aria-label', state.bpmSync ? 'BPM, synced to the project' : 'BPM')
    }
    document.querySelectorAll('.bpm-btn').forEach((button) => {
        if (button instanceof HTMLButtonElement) {
            button.disabled = state.bpmSync
        }
    })
    document.getElementById('bpm-sync')?.setAttribute('aria-pressed', state.bpmSync ? 'true' : 'false')
}

function paintRetrig() {
    const button = document.getElementById('retrig')
    if (button) {
        button.setAttribute('aria-pressed', state.retrig ? 'true' : 'false')
    }
}

function onRetrig() {
    state.retrig = !state.retrig
    paintRetrig()
    void native('setRetrig', state.retrig)
}

function onBpmSync() {
    state.bpmSync = !state.bpmSync
    paintBpm()
    void native('setBpmSync', state.bpmSync)
}

function bumpBpm(delta) {
    if (state.bpmSync) {
        return
    }
    const bpm = clampBpm(Math.round(state.bpm) + delta)
    if (bpm === null || bpm === state.bpm) {
        return
    }
    state.bpm = bpm
    const input = document.getElementById('bpm')
    if (input instanceof HTMLInputElement) {
        input.value = String(bpm)
    }
    void native('setBpm', bpm)
    redrawWaves()
}

function commitBpm() {
    const input = document.getElementById('bpm')
    if (!(input instanceof HTMLInputElement) || state.bpmSync) {
        return
    }
    const bpm = clampBpm(Number(input.value))
    if (bpm === null) {
        input.value = String(state.bpm)
        return
    }
    input.value = String(bpm)
    if (bpm === state.bpm) {
        return
    }
    state.bpm = bpm
    void native('setBpm', bpm)
    redrawWaves()
}

function onLoop() {
    const input = document.getElementById('loop')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const beats = input.valueAsNumber
    const fitted = fitSlice(state.sliceExp, beats)
    const sliceChanged = fitted !== state.sliceExp
    state.loopBeats = beats
    state.sliceExp = fitted
    placeThumb(input)
    if (sliceChanged) {
        setRange('slice', fitted)
        void native('setSlice', fitted)
    }
    syncCaptions()
    paintGrid()
    void native('setLoop', beats)
}

function onSlice() {
    const input = document.getElementById('slice')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const fitted = fitSlice(input.valueAsNumber, state.loopBeats)
    if (fitted !== input.valueAsNumber) {
        input.value = String(fitted)
    }
    placeThumb(input)
    if (fitted === state.sliceExp) {
        return
    }
    state.sliceExp = fitted
    syncCaptions()
    paintGrid()
    void native('setSlice', fitted)
}

function onAttack() {
    const input = document.getElementById('attack')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const ms = input.valueAsNumber
    placeThumb(input)
    if (ms === state.attackMs) {
        return
    }
    state.attackMs = ms
    syncCaptions()
    void native('setAttack', ms)
}

function onGlobalPower() {
    const input = document.getElementById('fx-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.globalPower) {
        return
    }
    state.globalPower = power
    void native('setGlobalPower', power)
}

function onGlobalBeat(event) {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const exponent = input.valueAsNumber
    let min = state.globalBeatMin
    let max = state.globalBeatMax
    if (input.id === 'fx-time-min') {
        min = exponent
        max = Math.max(max, exponent)
    } else {
        max = exponent
        min = Math.min(min, exponent)
    }
    const changed = min !== state.globalBeatMin || max !== state.globalBeatMax
    state.globalBeatMin = min
    state.globalBeatMax = max
    paintEffectTime()
    if (changed) {
        void native('setGlobalBeatRange', min, max)
    }
}

function onGlobalChance() {
    const input = document.getElementById('fx-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.globalChance) {
        return
    }
    state.globalChance = chance
    void native('setGlobalChance', chance)
}

function onReverbPower() {
    const input = document.getElementById('fx-reverb-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.reverbPower) {
        return
    }
    state.reverbPower = power
    void native('setReverbPower', power)
}

function onReverbChance() {
    const input = document.getElementById('fx-reverb-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.reverbChance) {
        return
    }
    state.reverbChance = chance
    void native('setReverbChance', chance)
}

function onDelayPower() {
    const input = document.getElementById('fx-delay-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.delayPower) {
        return
    }
    state.delayPower = power
    void native('setDelayPower', power)
}

function onDelayChance() {
    const input = document.getElementById('fx-delay-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.delayChance) {
        return
    }
    state.delayChance = chance
    void native('setDelayChance', chance)
}

function onReversePower() {
    const input = document.getElementById('fx-reverse-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.reversePower) {
        return
    }
    state.reversePower = power
    void native('setReversePower', power)
}

function onReverseChance() {
    const input = document.getElementById('fx-reverse-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.reverseChance) {
        return
    }
    state.reverseChance = chance
    void native('setReverseChance', chance)
}

function onFilterPower() {
    const input = document.getElementById('fx-filter-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.filterPower) {
        return
    }
    state.filterPower = power
    void native('setFilterPower', power)
}

function onFilterChance() {
    const input = document.getElementById('fx-filter-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.filterChance) {
        return
    }
    state.filterChance = chance
    void native('setFilterChance', chance)
}

function onFlangerPower() {
    const input = document.getElementById('fx-flanger-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.flangerPower) {
        return
    }
    state.flangerPower = power
    void native('setFlangerPower', power)
}

function onFlangerChance() {
    const input = document.getElementById('fx-flanger-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.flangerChance) {
        return
    }
    state.flangerChance = chance
    void native('setFlangerChance', chance)
}

function onTrancePower() {
    const input = document.getElementById('fx-trance-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.trancePower) {
        return
    }
    state.trancePower = power
    void native('setTrancePower', power)
}

function onTranceChance() {
    const input = document.getElementById('fx-trance-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.tranceChance) {
        return
    }
    state.tranceChance = chance
    void native('setTranceChance', chance)
}

function onShiftPower() {
    const input = document.getElementById('fx-shift-power')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const power = input.valueAsNumber
    if (power === state.shiftPower) {
        return
    }
    state.shiftPower = power
    void native('setShiftPower', power)
}

function onShiftChance() {
    const input = document.getElementById('fx-shift-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const chance = input.valueAsNumber
    if (chance === state.shiftChance) {
        return
    }
    state.shiftChance = chance
    void native('setShiftChance', chance)
}

// Beat repeat. SIZE index 0..6 is the exponent -5..1 (1/32 .. 2 beats). LENGTH index 0..5 is -4..1 (1/16 .. 2 beats).
const repeatSizeBase = -5
const repeatLengthBase = -4

function paintBeatRepeat() {
    const power = document.getElementById('br-power')
    if (power) {
        power.setAttribute('aria-pressed', state.repeatEnabled ? 'true' : 'false')
    }
    state.repeatPositions.forEach((on, index) => {
        const box = document.getElementById('br-pos-' + String(index + 1))
        if (box instanceof HTMLInputElement) {
            box.checked = on
        }
    })
    const lo = state.repeatSizeMin - repeatSizeBase
    const hi = state.repeatSizeMax - repeatSizeBase
    const range = document.getElementById('br-size')
    if (range) {
        range.style.setProperty('--lo', String(lo / 6))
        range.style.setProperty('--hi', String(hi / 6))
    }
    const min = document.getElementById('br-size-min')
    const max = document.getElementById('br-size-max')
    if (min instanceof HTMLInputElement && max instanceof HTMLInputElement) {
        min.value = String(lo)
        max.value = String(hi)
        min.setAttribute('aria-valuetext', sliceLabel(state.repeatSizeMin) + ' beat')
        max.setAttribute('aria-valuetext', sliceLabel(state.repeatSizeMax) + ' beat')
    }
    const sizeValue = document.getElementById('br-size-value')
    if (sizeValue) {
        sizeValue.textContent = '[' + sliceLabel(state.repeatSizeMin) + ',' + sliceLabel(state.repeatSizeMax) + ']'
    }
    const length = state.repeatLength - repeatLengthBase
    setRange('br-length', length)
    const lengthInput = document.getElementById('br-length')
    if (lengthInput instanceof HTMLInputElement) {
        lengthInput.setAttribute('aria-valuetext', sliceLabel(state.repeatLength) + ' beat')
    }
    const value = document.getElementById('br-length-value')
    if (value) {
        value.textContent = sliceLabel(state.repeatLength)
    }
    setRange('br-chance', state.repeatChance)
    setRange('br-mix', state.repeatMix)
}

function onRepeatPower() {
    state.repeatEnabled = !state.repeatEnabled
    paintBeatRepeat()
    void native('setRepeatEnabled', state.repeatEnabled)
}

function onRepeatPosition(event) {
    const box = event.currentTarget
    if (!(box instanceof HTMLInputElement)) {
        return
    }
    const index = Number(box.id.slice('br-pos-'.length)) - 1
    state.repeatPositions[index] = box.checked
    void native('setRepeatPosition', index, box.checked)
}

// Moving one SIZE pin past the other pushes the other along, so min never passes max.
function onRepeatSize(event) {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const exponent = input.valueAsNumber + repeatSizeBase
    let min = state.repeatSizeMin
    let max = state.repeatSizeMax
    if (input.id === 'br-size-min') {
        min = exponent
        max = Math.max(max, exponent)
    } else {
        max = exponent
        min = Math.min(min, exponent)
    }
    const changed = min !== state.repeatSizeMin || max !== state.repeatSizeMax
    state.repeatSizeMin = min
    state.repeatSizeMax = max
    paintBeatRepeat()
    if (changed) {
        void native('setRepeatSizeRange', min, max)
    }
}

function onRepeatLength() {
    const input = document.getElementById('br-length')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    placeThumb(input)
    const exponent = input.valueAsNumber + repeatLengthBase
    if (exponent === state.repeatLength) {
        return
    }
    state.repeatLength = exponent
    paintBeatRepeat()
    void native('setRepeatLength', exponent)
}

function onRepeatChance() {
    const input = document.getElementById('br-chance')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    placeThumb(input)
    const chance = input.valueAsNumber
    if (chance === state.repeatChance) {
        return
    }
    state.repeatChance = chance
    void native('setRepeatChance', chance)
}

function onRepeatMix() {
    const input = document.getElementById('br-mix')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    placeThumb(input)
    const mix = input.valueAsNumber
    if (mix === state.repeatMix) {
        return
    }
    state.repeatMix = mix
    void native('setRepeatMix', mix)
}

function onMaster(event) {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    state.outputVolume = holdSnap(input)
    void native('setOutput', state.outputVolume, state.outputPanMin, state.outputPanMax)
}

function paintMasterPan() {
    const range = document.getElementById('master-pan')
    if (range) {
        range.style.setProperty('--lo', String((state.outputPanMin + 1) / 2))
        range.style.setProperty('--hi', String((state.outputPanMax + 1) / 2))
    }
    const min = document.getElementById('master-pan-min')
    const max = document.getElementById('master-pan-max')
    if (min instanceof HTMLInputElement && max instanceof HTMLInputElement) {
        min.value = String(state.outputPanMin)
        max.value = String(state.outputPanMax)
    }
}

// Each PAN end is -1..1 and snaps to 0. Moving one pin past the other pushes the other along, so min never passes max.
function onMasterPan(event) {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    let value = input.valueAsNumber
    if (Math.abs(value) <= 2 * 0.04) {
        value = 0
    }
    let min = state.outputPanMin
    let max = state.outputPanMax
    if (input.id === 'master-pan-min') {
        min = value
        max = Math.max(max, value)
    } else {
        max = value
        min = Math.min(min, value)
    }
    const changed = min !== state.outputPanMin || max !== state.outputPanMax
    state.outputPanMin = min
    state.outputPanMax = max
    paintMasterPan()
    if (changed) {
        void native('setOutput', state.outputVolume, min, max)
    }
}

function onGain(event) {
    const input = event.currentTarget
    if (selected.length === 0 || !(input instanceof HTMLInputElement)) {
        return
    }
    const value = holdSnap(input)
    for (const index of selected) {
        const play = plays[index]
        if (!play) {
            continue
        }
        if (input.id === 'volume') {
            play.volume = value
        }
        if (input.id === 'pan') {
            play.pan = value
        }
    }
    if (input.id === 'volume') {
        redrawWaves()
    }
    syncPanel()
    commitTrack()
}

// The typed seconds go to every selected row, each held inside its own file.
function commitStartTime() {
    const field = document.getElementById('start-time')
    if (!(field instanceof HTMLInputElement) || selected.length === 0) {
        return
    }
    const parsed = Number.parseFloat(field.value.trim().replace(',', '.'))
    const seconds = Number.isFinite(parsed) ? parsed : 0
    for (const index of selected) {
        const play = plays[index]
        if (!play) {
            continue
        }
        const duration = durationSec(index)
        const clamped = Math.min(duration, Math.max(0, seconds))
        play.start = duration > 0 ? clamped / duration : 0
    }
    field.value = shared(startSeconds) ?? '--'
    setRange('start', shared((index) => plays[index]?.start))
    redrawWaves()
    commitTrack()
}

function onRegion(event) {
    const input = event.currentTarget
    if (selected.length === 0 || !(input instanceof HTMLInputElement)) {
        return
    }
    for (const index of selected) {
        const play = plays[index]
        if (!play) {
            continue
        }
        if (input.id === 'start') {
            play.start = Number(input.value)
        }
        if (input.id === 'length') {
            play.length = Number(input.value)
        }
    }
    placeThumb(input)
    syncPanel()
    redrawWaves()
    commitTrack()
}

wire()
