import type { EngineClient } from '../../hosts/web/client/EngineClient'
import type { WebViewModel } from '../../viewmodels/web/WebViewModel'

function isAbort(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

// Turns control actions into client calls, and snapshots into the view model.
export class WebPresenter {
    constructor(
        private readonly model: WebViewModel,
        private readonly client: EngineClient,
    ) {
        model.bind({
            playOrStop: () => void this.perform(() => this.playOrStop()),
            append: (files) => void this.perform(() => this.append(files)),
            remove: (index) => void this.perform(() => this.remove(index)),
            randomize: () => void this.perform(() => this.randomize()),
            setBpm: (bpm) => void this.perform(() => this.client.setBpm(bpm)),
            setLoop: (beats) => void this.perform(() => this.client.setLoop(beats)),
            setSlice: (exponent) => void this.perform(() => this.client.setSlice(exponent)),
        })
        client.onSnapshot = (snapshot) => {
            model.show({ names: snapshot.names, playing: snapshot.playing, sliceExp: snapshot.sliceExp })
        }
        client.onError = (message) => model.fail(message)
    }

    private async playOrStop() {
        if (!this.model.hasTracks) {
            return
        }
        if (this.model.playing) {
            await this.client.stop()
            return
        }
        await this.client.play()
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
