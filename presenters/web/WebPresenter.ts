import type { EngineClient } from '../../hosts/web/client/EngineClient'
import type { WebViewModel } from '../../viewmodels/web/WebViewModel'
import { SampleBufferPresenter } from './SampleBufferPresenter'
import { SampleBufferView } from '../../views/web/SampleBufferView'

interface SampleRow {
    samples: Float32Array
    presenter: SampleBufferPresenter
    element: HTMLElement
}

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

// Turns control actions into client calls, and snapshots into the view model.
export class WebPresenter {
    private playSlot = -1
    private playTrack = -1
    private rows: SampleRow[] = []

    constructor(
        private readonly model: WebViewModel,
        private readonly client: EngineClient,
        private readonly bank: HTMLElement,
        loadPack: () => Promise<void>,
    ) {
        model.bind({
            midi: (status, note, velocity) => void this.perform(() => this.client.midi(status, note, velocity)),
            loadPack: () => this.perform(loadPack),
            append: (files) => void this.perform(() => this.append(files)),
            remove: (index) => void this.perform(() => this.remove(index)),
            randomize: () => void this.perform(() => this.randomize()),
            setBpm: (bpm) => void this.perform(() => this.client.setBpm(bpm)),
            setLoop: (beats) => void this.perform(() => this.client.setLoop(beats)),
            setSlice: (exponent) => void this.perform(() => this.client.setSlice(exponent)),
            setAttack: (ms) => void this.perform(() => this.client.setAttack(ms)),
        })
        client.onSnapshot = (snapshot) => {
            this.playSlot = snapshot.playing ? snapshot.playSlot : -1
            this.playTrack = snapshot.playing ? snapshot.playTrack : -1
            model.show({ names: snapshot.names, playing: snapshot.playing, sliceExp: snapshot.sliceExp })
            this.markPlaying()
        }
        client.onError = (message) => model.fail(message)
        model.subscribe(() => this.sync())
        this.sync()
    }

    private sync() {
        this.followSample()
        this.markPlaying()
    }

    private followSample() {
        const waves: { samples: Float32Array; sampleRate: number; name: string }[] = []
        for (let index = 0; index < this.model.tracks.length; index++) {
            const wave = this.client.registry.wave(index)
            if (!wave) {
                continue
            }
            waves.push({ samples: wave.samples, sampleRate: wave.sampleRate, name: this.model.tracks[index].name })
        }
        const kept = new Set(waves.map((wave) => wave.samples))
        this.rows = this.rows.filter((row) => {
            if (kept.has(row.samples)) {
                return true
            }
            row.presenter.clear()
            row.element.remove()
            return false
        })
        const sliceBeats = 2 ** this.model.sliceExp
        for (const wave of waves) {
            let row = this.rows.find((item) => item.samples === wave.samples)
            if (!row) {
                row = this.createRow(wave.name, wave.samples)
                this.rows.push(row)
            }
            row.presenter.follow({
                samples: wave.samples,
                sampleRate: wave.sampleRate,
                bpm: this.model.bpm,
                loopBeats: this.model.loopBeats,
                sliceBeats,
            })
            this.bank.append(row.element)
        }
    }

    private createRow(name: string, samples: Float32Array): SampleRow {
        const element = document.createElement('div')
        element.className = 'sample-row'
        const title = document.createElement('div')
        title.className = 'sample-row-title'
        const label = document.createElement('span')
        label.textContent = name
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = 'Remove'
        remove.addEventListener('click', () => {
            const index = this.indexOf(samples)
            if (index >= 0) {
                this.model.remove(index)
            }
        })
        title.append(label, remove)
        const host = document.createElement('div')
        element.append(title, host)
        const view = new SampleBufferView(host)
        view.setName(name)
        const presenter = new SampleBufferPresenter(view)
        presenter.onEdit = (start, length, loop) => {
            const index = this.indexOf(samples)
            if (index >= 0) {
                void this.client.setTrack(index, start, length, loop)
            }
        }
        return { samples, presenter, element }
    }

    private indexOf(samples: Float32Array): number {
        for (let index = 0; index < this.model.tracks.length; index++) {
            if (this.client.registry.wave(index)?.samples === samples) {
                return index
            }
        }
        return -1
    }

    private markPlaying() {
        const sliceBeats = 2 ** this.model.sliceExp
        for (let index = 0; index < this.model.tracks.length; index++) {
            const wave = this.client.registry.wave(index)
            if (!wave) {
                continue
            }
            const row = this.rows.find((item) => item.samples === wave.samples)
            if (!row) {
                continue
            }
            const heard = this.playSlot >= 0 && index === this.playTrack
            row.presenter.setPlayhead(heard ? this.playSlot * sliceBeats : -1)
        }
    }

    private async append(files: File[]) {
        await this.client.append(files)
    }

    private async remove(index: number) {
        if (!this.model.hasTracks) {
            return
        }
        await this.client.removeAt(index)
    }

    private async randomize() {
        if (!this.model.hasTracks) {
            return
        }
        await this.client.randomize()
    }

    private async perform(action: () => Promise<void>) {
        try {
            await action()
        } catch (error) {
            // The file dialog rejects with AbortError when the user dismisses it.
            if (isAbort(error)) {
                return
            }
            this.model.fail(error instanceof Error ? error.message : String(error))
        }
    }
}
