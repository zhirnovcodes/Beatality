import { useEffect, useState } from 'preact/hooks'
import type { WebViewModel } from '../../../viewmodels/web/WebViewModel'

export function Widget({ model }: { model: WebViewModel }) {
    const [, setTick] = useState(0)
    useEffect(() => model.subscribe(() => setTick((tick) => tick + 1)), [model])

    // The input sits inside its label. A click on the input would bubble to the
    // label, which clicks the input again and opens a second dialog. That second
    // dialog cancels the first.
    const onPickClick = (event: Event) => {
        event.stopPropagation()
    }

    // Cancel, or choosing the same files again, fires `cancel` and leaves the list as it is.
    const onCancel = (event: Event) => {
        event.stopPropagation()
    }

    const onFiles = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        const files = Array.from(input.files ?? [])
        // Dismissing the dialog reports an empty selection. Nothing was added.
        if (files.length === 0) {
            return
        }
        input.value = ''
        model.append(files)
    }

    return (
        <main>
            <h1>Beatality</h1>
            <button id="transport" type="button" disabled={!model.hasTracks} onClick={() => model.playOrStop()}>
                {model.playLabel}
            </button>
            <ul id="samples">
                {model.tracks.map((track, index) => (
                    <li key={index} class={track.chosen ? 'chosen' : undefined}>
                        {track.chosen ? 'Chosen: ' : ''}
                        {track.name}
                    </li>
                ))}
            </ul>
            <label class="append">
                Append
                <input
                    type="file"
                    accept=".wav,.mp3,audio/wav,audio/mpeg"
                    multiple
                    onClick={onPickClick}
                    onCancel={onCancel}
                    onChange={onFiles}
                />
            </label>
            <div class="row">
                <button id="remove" type="button" disabled={!model.hasTracks} onClick={() => model.remove()}>
                    Remove
                </button>
                <button id="randomize" type="button" disabled={!model.hasTracks} onClick={() => model.randomize()}>
                    Randomize
                </button>
            </div>
            {model.error ? <p class="error">{model.error}</p> : null}
        </main>
    )
}
