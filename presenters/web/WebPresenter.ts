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
            remove: () => void this.perform(() => this.remove()),
            randomize: () => void this.perform(() => this.client.randomize()),
        })
        client.onSnapshot = (snapshot) => {
            model.show({ names: snapshot.names, index: snapshot.index, playing: snapshot.playing })
        }
        client.onError = (message) => model.fail(message)
    }

    private async playOrStop() {
        if (this.model.playing) {
            await this.client.stop()
            return
        }
        // Play is the only control that starts the sound. Nothing chosen yet: pick one first.
        if (this.model.hasTracks && !this.model.tracks.some((track) => track.chosen)) {
            await this.client.randomize()
        }
        await this.client.play()
    }

    private async append(files: File[]) {
        const added = await this.client.append(files)
        if (added > 0) {
            await this.client.randomize()
        }
    }

    private async remove() {
        if (!this.model.hasTracks) {
            return
        }
        const tracksRemain = this.model.tracks.length > 1
        await this.client.removeFirst()
        if (tracksRemain) {
            await this.client.randomize()
        }
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
