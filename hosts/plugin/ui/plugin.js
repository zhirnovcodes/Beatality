// Host page for the skin. The processor owns the audio; this page only draws and sends edits.

const state = {
    bpm: 120,
    loopBeats: 8,
    sliceExp: 0,
    attackMs: 2,
    playhead: 0,
    playTrack: -1,
    playSlot: -1,
    canAppend: true,
}

const plays = []
let pictures = { names: [], rates: [], frames: [], peaks: [] }
let selected = -1
let epoch = -1
let pendingRemove = -1
let builtKey = ''

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
    const slider = input.closest('.slider, .seek')
    if (!(slider instanceof HTMLElement)) {
        return
    }
    const min = Number(input.min)
    const max = Number(input.max)
    const value = Number(input.value)
    const pos = max > min ? (value - min) / (max - min) : 0
    slider.style.setProperty('--pos', String(pos))
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
    const randomize = document.getElementById('randomize')
    if (append instanceof HTMLButtonElement) {
        append.disabled = !state.canAppend
    }
    if (remove instanceof HTMLButtonElement) {
        remove.disabled = !has
    }
    if (clear instanceof HTMLButtonElement) {
        clear.disabled = !has
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
    const mid = height * 0.5
    const half = height * 0.5
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
        const bar = Math.max(peaks[column] * half, 0.5)
        ctx.fillRect(x, mid - bar, 1, bar * 2)
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

function syncPanel() {
    const panel = document.getElementById('selected-sample')
    if (panel instanceof HTMLFieldSetElement) {
        panel.disabled = selected < 0
    }
    const play = plays[selected]
    if (!play) {
        return
    }
    setRange('start', play.start)
    setRange('length', play.length)
    const loop = document.getElementById('track-loop')
    if (loop instanceof HTMLInputElement && document.activeElement !== loop) {
        loop.checked = play.loop
    }
}

function structureKey() {
    return columns() + '|' + plays.map((play) => play.name).join('\n')
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

function replacePlays(names) {
    plays.splice(0, plays.length, ...names.map((name) => ({ name, start: 0, length: 1, loop: false })))
    selected = -1
}

function onBank(bank) {
    const names = bank.names || []
    if (bank.epoch !== epoch) {
        epoch = bank.epoch
        pendingRemove = -1
        replacePlays(names)
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
            plays.push({ name: names[index], start: 0, length: 1, loop: false })
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

function commitTrack() {
    const play = plays[selected]
    if (!play || selected < 0) {
        return
    }
    void native('setTrack', selected, play.start, play.length, play.loop)
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
    const content = document.getElementById('sample-grid')
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

    const start = document.getElementById('start')
    const length = document.getElementById('length')
    start?.addEventListener('input', onRegion)
    length?.addEventListener('input', onRegion)
    start?.addEventListener('change', commitTrack)
    length?.addEventListener('change', commitTrack)
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
        const button = document.getElementById('load-bank')
        if (button instanceof HTMLButtonElement) {
            button.disabled = true
        }
        void native('loadBank').finally(() => {
            if (button instanceof HTMLButtonElement) {
                button.disabled = false
            }
        })
    })
    document.getElementById('randomize')?.addEventListener('click', () => {
        if (plays.length === 0) {
            return
        }
        void native('randomize')
    })

    document.querySelectorAll('.slider input').forEach((input) => {
        if (input instanceof HTMLInputElement) {
            placeThumb(input)
        }
    })
    setRange('playhead', 0)
    syncCaptions()
    attachSampleScroll()
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

function onRegion(event) {
    const play = plays[selected]
    const input = event.currentTarget
    if (!play || !(input instanceof HTMLInputElement)) {
        return
    }
    if (input.id === 'start') {
        play.start = Number(input.value)
    }
    if (input.id === 'length') {
        play.length = Number(input.value)
    }
    placeThumb(input)
    const canvas = document.querySelectorAll('#sample-grid .row')[selected]?.querySelector('canvas')
    if (canvas instanceof HTMLCanvasElement) {
        drawWave(canvas, selected)
    }
}

wire()
