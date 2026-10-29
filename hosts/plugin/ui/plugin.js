// Host page for the skin. The processor owns the audio; this page only draws and sends edits.

const state = {
    bpm: 120,
    loopBeats: 8,
    sliceExp: 0,
    attackMs: 2,
    globalPower: 1,
    globalBeat: 0,
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
    playhead: 0,
    playTrack: -1,
    playSlot: -1,
    canAppend: true,
    outputVolume: 1,
    outputPan: 0,
}

const plays = []
let pictures = { names: [], rates: [], frames: [], peaks: [] }
let selected = -1
let epoch = -1
let pendingRemove = -1
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

function setRange(id, value) {
    const input = document.getElementById(id)
    if (!(input instanceof HTMLInputElement) || document.activeElement === input) {
        return
    }
    input.value = String(value)
    placeThumb(input)
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

function syncButtons() {
    const has = plays.length > 0
    const append = document.getElementById('append')
    const remove = document.getElementById('remove')
    const clear = document.getElementById('clear')
    const load = document.getElementById('load-bank')
    const save = document.getElementById('save')
    const randomize = document.getElementById('randomize')
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
    if (randomize instanceof HTMLButtonElement) {
        randomize.disabled = !has
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

    const bpm = state.bpm > 0 ? state.bpm : 120
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
        row.setAttribute('aria-selected', index === selected ? 'true' : 'false')
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
        panel.disabled = selected < 0
    }
    const play = plays[selected]
    const duration = play ? durationSec(selected) : 0
    const startTime = document.getElementById('start-time')
    if (startTime instanceof HTMLInputElement) {
        const limit = duration > 0 ? duration : 0
        startTime.dataset.max = String(limit)
        startTime.max = String(limit)
    }
    if (!play) {
        setRange('volume', 1)
        setRange('pan', 0)
        setRange('start', 0)
        setRange('length', 1)
        writeStartTime(0)
        const loop = document.getElementById('track-loop')
        if (loop instanceof HTMLInputElement && document.activeElement !== loop) {
            loop.checked = false
        }
        return
    }
    setRange('volume', play.volume)
    setRange('pan', play.pan)
    setRange('start', play.start)
    setRange('length', play.length)
    writeStartTime(play.start * duration)
    const loop = document.getElementById('track-loop')
    if (loop instanceof HTMLInputElement && document.activeElement !== loop) {
        loop.checked = play.loop
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
        row.addEventListener('click', () => {
            selected = index
            markRows()
            syncPanel()
        })
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

function freshPlay(name) {
    return { name, start: 0, length: 1, loop: false, volume: 1, pan: 0, missing: false }
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
        missing: !!(bank.missing && bank.missing[index]),
    }
}

function replacePlays(names) {
    plays.splice(0, plays.length, ...names.map(freshPlay))
    selected = -1
}

function onBank(bank) {
    const names = bank.names || []
    if (bank.epoch !== epoch) {
        epoch = bank.epoch
        pendingRemove = -1
        plays.splice(0, plays.length, ...names.map((name, index) => playFromBank(name, bank, index)))
        selected = -1
        applyBankSettings(bank)
    } else if (pendingRemove >= 0 && names.length === plays.length - 1) {
        const index = pendingRemove
        pendingRemove = -1
        plays.splice(index, 1)
        if (selected === index) {
            selected = -1
        } else if (selected > index) {
            selected -= 1
        }
    } else if (names.length >= plays.length && plays.every((play, index) => play.name === names[index])) {
        pendingRemove = -1
        for (let index = plays.length; index < names.length; index++) {
            plays.push(freshPlay(names[index]))
        }
    } else {
        pendingRemove = -1
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
    syncButtons()
    markRows()
}

function applyBankSettings(bank) {
    if (bank.bpm == null) {
        return
    }
    const bpm = clampBpm(Number(bank.bpm))
    if (bpm !== null) {
        state.bpm = bpm
        const input = document.getElementById('bpm')
        if (input instanceof HTMLInputElement) {
            input.value = String(bpm)
        }
    }
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
    if (bank.globalPower != null && Number.isFinite(Number(bank.globalPower))) {
        state.globalPower = Number(bank.globalPower)
        setRange('global-power', state.globalPower)
    }
    if (bank.globalBeat != null && Number.isInteger(Number(bank.globalBeat))) {
        state.globalBeat = Number(bank.globalBeat)
        setRange('global-beat', state.globalBeat)
        const beat = document.getElementById('global-beat-value')
        if (beat) {
            beat.textContent = sliceLabel(state.globalBeat)
        }
    }
    if (bank.globalChance != null && Number.isFinite(Number(bank.globalChance))) {
        state.globalChance = Number(bank.globalChance)
        setRange('global-chance', state.globalChance)
    }
    if (bank.reverbPower != null && Number.isFinite(Number(bank.reverbPower))) {
        state.reverbPower = Number(bank.reverbPower)
        setRange('reverb-power', state.reverbPower)
    }
    if (bank.reverbChance != null && Number.isFinite(Number(bank.reverbChance))) {
        state.reverbChance = Number(bank.reverbChance)
        setRange('reverb-chance', state.reverbChance)
    }
    if (bank.delayPower != null && Number.isFinite(Number(bank.delayPower))) {
        state.delayPower = Number(bank.delayPower)
        setRange('delay-power', state.delayPower)
    }
    if (bank.delayChance != null && Number.isFinite(Number(bank.delayChance))) {
        state.delayChance = Number(bank.delayChance)
        setRange('delay-chance', state.delayChance)
    }
    if (bank.reversePower != null && Number.isFinite(Number(bank.reversePower))) {
        state.reversePower = Number(bank.reversePower)
        setRange('reverse-power', state.reversePower)
    }
    if (bank.reverseChance != null && Number.isFinite(Number(bank.reverseChance))) {
        state.reverseChance = Number(bank.reverseChance)
        setRange('reverse-chance', state.reverseChance)
    }
    if (bank.filterPower != null && Number.isFinite(Number(bank.filterPower))) {
        state.filterPower = Number(bank.filterPower)
        setRange('filter-power', state.filterPower)
    }
    if (bank.filterChance != null && Number.isFinite(Number(bank.filterChance))) {
        state.filterChance = Number(bank.filterChance)
        setRange('filter-chance', state.filterChance)
    }
    if (bank.flangerPower != null && Number.isFinite(Number(bank.flangerPower))) {
        state.flangerPower = Number(bank.flangerPower)
        setRange('flanger-power', state.flangerPower)
    }
    if (bank.flangerChance != null && Number.isFinite(Number(bank.flangerChance))) {
        state.flangerChance = Number(bank.flangerChance)
        setRange('flanger-chance', state.flangerChance)
    }
    if (bank.trancePower != null && Number.isFinite(Number(bank.trancePower))) {
        state.trancePower = Number(bank.trancePower)
        setRange('trance-power', state.trancePower)
    }
    if (bank.tranceChance != null && Number.isFinite(Number(bank.tranceChance))) {
        state.tranceChance = Number(bank.tranceChance)
        setRange('trance-chance', state.tranceChance)
    }
    if (bank.shiftPower != null && Number.isFinite(Number(bank.shiftPower))) {
        state.shiftPower = Number(bank.shiftPower)
        setRange('shift-power', state.shiftPower)
    }
    if (bank.shiftChance != null && Number.isFinite(Number(bank.shiftChance))) {
        state.shiftChance = Number(bank.shiftChance)
        setRange('shift-chance', state.shiftChance)
    }
    const volume = Number(bank.volume)
    const pan = Number(bank.pan)
    if (Number.isFinite(volume)) {
        state.outputVolume = volume
        setRange('master-volume', volume)
    }
    if (Number.isFinite(pan)) {
        state.outputPan = pan
        setRange('master-pan', pan)
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
    const play = plays[selected]
    if (!play || selected < 0) {
        return
    }
    void native('setTrack', selected, play.start, play.length, play.loop, play.volume, play.pan)
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

function wire() {
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

    document.querySelector('.bpm-btn.plus')?.addEventListener('click', () => bumpBpm(1))
    document.querySelector('.bpm-btn.minus')?.addEventListener('click', () => bumpBpm(-1))
    document.getElementById('bpm')?.addEventListener('input', commitBpm)
    document.getElementById('bpm')?.addEventListener('blur', () => {
        const input = document.getElementById('bpm')
        if (input instanceof HTMLInputElement) {
            input.value = String(state.bpm)
        }
    })

    document.getElementById('loop')?.addEventListener('input', onLoop)
    document.getElementById('slice')?.addEventListener('input', onSlice)
    document.getElementById('attack')?.addEventListener('input', onAttack)
    document.getElementById('global-power')?.addEventListener('input', onGlobalPower)
    document.getElementById('global-beat')?.addEventListener('input', onGlobalBeat)
    document.getElementById('global-chance')?.addEventListener('input', onGlobalChance)
    document.getElementById('reverb-power')?.addEventListener('input', onReverbPower)
    document.getElementById('reverb-chance')?.addEventListener('input', onReverbChance)
    document.getElementById('delay-power')?.addEventListener('input', onDelayPower)
    document.getElementById('delay-chance')?.addEventListener('input', onDelayChance)
    document.getElementById('reverse-power')?.addEventListener('input', onReversePower)
    document.getElementById('reverse-chance')?.addEventListener('input', onReverseChance)
    document.getElementById('filter-power')?.addEventListener('input', onFilterPower)
    document.getElementById('filter-chance')?.addEventListener('input', onFilterChance)
    document.getElementById('flanger-power')?.addEventListener('input', onFlangerPower)
    document.getElementById('flanger-chance')?.addEventListener('input', onFlangerChance)
    document.getElementById('trance-power')?.addEventListener('input', onTrancePower)
    document.getElementById('trance-chance')?.addEventListener('input', onTranceChance)
    document.getElementById('shift-power')?.addEventListener('input', onShiftPower)
    document.getElementById('shift-chance')?.addEventListener('input', onShiftChance)

    document.getElementById('master-volume')?.addEventListener('input', onMaster)
    document.getElementById('master-pan')?.addEventListener('input', onMaster)
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
    document.getElementById('track-loop')?.addEventListener('change', () => {
        const play = plays[selected]
        const loop = document.getElementById('track-loop')
        if (!play || !(loop instanceof HTMLInputElement)) {
            return
        }
        play.loop = loop.checked
        const canvas = document.querySelectorAll('#sample-grid .row')[selected]?.querySelector('canvas')
        if (canvas instanceof HTMLCanvasElement) {
            drawWave(canvas, selected)
        }
        commitTrack()
    })

    document.getElementById('append')?.addEventListener('click', () => {
        void native('append')
    })
    document.getElementById('remove')?.addEventListener('click', () => {
        if (plays.length === 0) {
            return
        }
        pendingRemove = selected < 0 ? 0 : selected
        void native('remove', pendingRemove)
    })
    document.getElementById('clear')?.addEventListener('click', () => {
        if (plays.length === 0) {
            return
        }
        void native('clear')
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
    document.getElementById('randomize')?.addEventListener('click', () => {
        if (plays.length === 0) {
            return
        }
        void native('randomize')
    })

    document.querySelectorAll('.slider input, .mix-slider input').forEach((input) => {
        if (input instanceof HTMLInputElement) {
            placeThumb(input)
        }
    })
    setRange('playhead', 0)
    syncCaptions()
    attachSampleScroll()
    void native('banks').then((list) => {
        banks = Array.isArray(list) ? list : []
    })
    void native('ready')
}

function bumpBpm(delta) {
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
    if (!(input instanceof HTMLInputElement)) {
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
    const input = document.getElementById('global-power')
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

function onGlobalBeat() {
    const input = document.getElementById('global-beat')
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const exponent = input.valueAsNumber
    const beat = document.getElementById('global-beat-value')
    if (beat) {
        beat.textContent = sliceLabel(exponent)
    }
    if (exponent === state.globalBeat) {
        return
    }
    state.globalBeat = exponent
    void native('setGlobalBeat', exponent)
}

function onGlobalChance() {
    const input = document.getElementById('global-chance')
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
    const input = document.getElementById('reverb-power')
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
    const input = document.getElementById('reverb-chance')
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
    const input = document.getElementById('delay-power')
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
    const input = document.getElementById('delay-chance')
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
    const input = document.getElementById('reverse-power')
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
    const input = document.getElementById('reverse-chance')
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
    const input = document.getElementById('filter-power')
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
    const input = document.getElementById('filter-chance')
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
    const input = document.getElementById('flanger-power')
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
    const input = document.getElementById('flanger-chance')
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
    const input = document.getElementById('trance-power')
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
    const input = document.getElementById('trance-chance')
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
    const input = document.getElementById('shift-power')
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
    const input = document.getElementById('shift-chance')
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

function onMaster(event) {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
        return
    }
    const value = holdSnap(input)
    if (input.id === 'master-volume') {
        state.outputVolume = value
    } else {
        state.outputPan = value
    }
    void native('setOutput', state.outputVolume, state.outputPan)
}

function onGain(event) {
    const play = plays[selected]
    const input = event.currentTarget
    if (!play || !(input instanceof HTMLInputElement)) {
        return
    }
    const value = holdSnap(input)
    if (input.id === 'volume') {
        play.volume = value
        const canvas = document.querySelectorAll('#sample-grid .row')[selected]?.querySelector('canvas')
        if (canvas instanceof HTMLCanvasElement) {
            drawWave(canvas, selected)
        }
    }
    if (input.id === 'pan') {
        play.pan = value
    }
    commitTrack()
}

function commitStartTime() {
    const field = document.getElementById('start-time')
    const play = plays[selected]
    if (!(field instanceof HTMLInputElement) || !play || selected < 0) {
        return
    }
    const duration = durationSec(selected)
    const parsed = Number.parseFloat(field.value.trim().replace(',', '.'))
    const seconds = Number.isFinite(parsed) ? parsed : 0
    const clamped = Math.min(duration, Math.max(0, seconds))
    play.start = duration > 0 ? clamped / duration : 0
    field.value = clamped.toFixed(2)
    setRange('start', play.start)
    const canvas = document.querySelectorAll('#sample-grid .row')[selected]?.querySelector('canvas')
    if (canvas instanceof HTMLCanvasElement) {
        drawWave(canvas, selected)
    }
    commitTrack()
}

function onRegion(event) {
    const play = plays[selected]
    const input = event.currentTarget
    if (!play || !(input instanceof HTMLInputElement)) {
        return
    }
    if (input.id === 'start') {
        play.start = Number(input.value)
        writeStartTime(play.start * durationSec(selected))
    }
    if (input.id === 'length') {
        play.length = Number(input.value)
    }
    placeThumb(input)
    const canvas = document.querySelectorAll('#sample-grid .row')[selected]?.querySelector('canvas')
    if (canvas instanceof HTMLCanvasElement) {
        drawWave(canvas, selected)
    }
    commitTrack()
}

wire()
