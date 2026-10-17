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
            playOrStop: () => void this.perform(() => (model.playing ? this.client.stop() : this.client.play())),
            append: (files) => void this.perform(() => this.client.append(files)),
            remove: () => void this.perform(() => this.client.removeFirst()),
            randomize: () => void this.perform(() => this.client.randomize()),
        })
        client.onSnapshot = (snapshot) => {
            model.show({ names: snapshot.names, index: snapshot.index, playing: snapshot.playing })
        }
        client.onError = (message) => model.fail(message)
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
