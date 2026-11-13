import type { HostContext, PluginFactory, PluginInstance, TransportState } from '../../../hosts/web/plugin-v2'

// A minimal IvanDAW for daw-test.html. It loads the built dist-daw/ from a sub-path, as the DAW will,
// so run `pnpm --filter @beatality/web-widget build:daw` first. The dev server serves it at /x/beatality/.
const moduleUrl = new URL('/x/beatality/index.js', location.href).href

function element<T extends HTMLElement>(id: string, type: new () => T): T {
    const found = document.getElementById(id)
    if (!(found instanceof type)) {
        throw new Error(`missing #${id}`)
    }
    return found
}

const logView = element('log', HTMLDivElement)
const log = (text: string) => {
    logView.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`
    logView.scrollTop = logView.scrollHeight
}

const slot = element('slot', HTMLDivElement)
const buttons = {
    start: element('start', HTMLButtonElement),
    noteOn: element('note-on', HTMLButtonElement),
    noteOff: element('note-off', HTMLButtonElement),
    allOff: element('all-off', HTMLButtonElement),
    mount: element('mount', HTMLButtonElement),
    lfo: element('lfo', HTMLButtonElement),
    play: element('play', HTMLButtonElement),
    tempo: element('tempo', HTMLButtonElement),
    state: element('state', HTMLButtonElement),
    dispose: element('dispose', HTMLButtonElement),
}

const context = new AudioContext()
const transport: TransportState = { playing: false, bpm: 120, beat: 0, numerator: 4, denominator: 4, loop: null }
const host: HostContext = {
    audioContext: context,
    apiVersion: 2,
    slotId: 'test-1',
    transport: () => transport,
    notify: (level, message) => log(`notify ${level}: ${message}`),
    markDirty: () => log('markDirty'),
    assetUrl: (path) => new URL(path, moduleUrl).href,
}

let plugin: PluginInstance | null = null
let mounted = true
let lfo = 0

const note = 36
const midi = (bytes: [number, number, number]) => plugin?.schedule([{ type: 'midi', time: context.currentTime, bytes }])

buttons.start.addEventListener('click', async () => {
    buttons.start.disabled = true
    // The host owns the context and starts it inside a click.
    await context.resume()
    try {
        const factory = ((await import(/* @vite-ignore */ moduleUrl)) as { default: PluginFactory }).default
        log(`loaded ${factory.manifest.name} ${factory.manifest.version}, api ${factory.manifest.apiVersion}`)
        const started = performance.now()
        plugin = await factory.create(host, null)
        log(`create(host, null) resolved in ${Math.round(performance.now() - started)} ms`)
        const out = plugin.ports.get('out')
        if (!out || !('node' in out)) {
            throw new Error('no audio port "out"')
        }
        out.node.connect(context.destination)
        plugin.subscribe((change) => log(`change ${change.id} = ${change.value.toFixed(3)} (${change.source})`))
        log(`${plugin.parameters().length} parameters`)
        plugin.mount(slot)
        for (const button of Object.values(buttons)) {
            button.disabled = button === buttons.start
        }
    } catch (error) {
        log(`failed: ${error instanceof Error ? error.message : String(error)}`)
        buttons.start.disabled = false
    }
})

buttons.noteOn.addEventListener('click', () => midi([0x90, note, 100]))
buttons.noteOff.addEventListener('click', () => midi([0x80, note, 0]))
buttons.allOff.addEventListener('click', () => midi([0xb0, 123, 0]))

buttons.mount.addEventListener('click', () => {
    mounted = !mounted
    if (mounted) {
        plugin?.mount(slot)
    } else {
        plugin?.unmount()
    }
    buttons.mount.textContent = mounted ? 'Unmount' : 'Mount'
})

// 40 writes a second, swelling about twice a second, as IvanDAW's LFO does.
buttons.lfo.addEventListener('click', () => {
    if (lfo) {
        window.clearInterval(lfo)
        lfo = 0
    } else {
        lfo = window.setInterval(() => {
            const value = 0.5 + 0.4 * Math.sin(2 * Math.PI * 2 * context.currentTime)
            plugin?.schedule([{ type: 'automation', time: context.currentTime, id: 'volume', value, source: 'binding' }])
        }, 25)
    }
    buttons.lfo.setAttribute('aria-pressed', String(lfo !== 0))
})

// The project's playhead: transport.beat at anchor, in the context's seconds, moving while playing.
let anchor = 0
const beatNow = (time: number) => (transport.playing ? transport.beat + ((time - anchor) * transport.bpm) / 60 : transport.beat)
const sendTransport = (time: number) => {
    plugin?.schedule([{ type: 'transport', time, state: { ...transport } }])
    log(`transport ${transport.playing ? 'playing' : 'stopped'} at beat ${transport.beat.toFixed(2)}, ${transport.bpm} bpm`)
}

buttons.play.addEventListener('click', () => {
    const time = context.currentTime
    transport.beat = beatNow(time)
    transport.playing = !transport.playing
    anchor = time
    sendTransport(time)
    buttons.play.setAttribute('aria-pressed', String(transport.playing))
})

buttons.tempo.addEventListener('click', () => {
    const time = context.currentTime
    transport.beat = beatNow(time)
    anchor = time
    transport.bpm = transport.bpm === 90 ? 120 : 90
    plugin?.schedule([{ type: 'tempo', time, bpm: transport.bpm }])
    if (transport.playing) {
        sendTransport(time)
    }
    buttons.tempo.textContent = `Tempo ${transport.bpm === 90 ? 120 : 90}`
    log(`tempo ${transport.bpm}`)
})

buttons.state.addEventListener('click', async () => {
    if (!plugin) {
        return
    }
    const state = await plugin.getState()
    log(`getState: ${JSON.stringify(state).length} bytes`)
    await plugin.setState(JSON.parse(JSON.stringify(state)))
    log('setState done')
    await plugin.setState({ pluginId: 'other', pluginVersion: '1', data: null }).then(
        () => log('BUG: foreign state accepted'),
        (error: Error) => log(`foreign state rejected: ${error.message}`),
    )
})

buttons.dispose.addEventListener('click', () => {
    window.clearInterval(lfo)
    lfo = 0
    plugin?.dispose()
    plugin = null
    for (const button of Object.values(buttons)) {
        button.disabled = button !== buttons.start
    }
    log('disposed')
})
