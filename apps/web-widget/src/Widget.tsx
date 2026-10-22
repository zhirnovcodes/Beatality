import { useEffect, useState } from 'preact/hooks'
import type { WebViewModel } from '../../../viewmodels/web/WebViewModel'
import './sampleBufferView.css'

export function Widget({ model, bank }: { model: WebViewModel; bank: HTMLElement }) {
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

    const onBpm = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setBpm(input.valueAsNumber)
        input.value = String(model.bpm)
    }

    const onLoop = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setLoop(input.valueAsNumber)
        input.value = String(model.loopBeats)
    }

    const onSlice = (event: Event) => {
        const select = event.currentTarget as HTMLSelectElement
        model.setSlice(Number(select.value))
    }

    const onAttack = (event: Event) => {
        const input = event.currentTarget as HTMLInputElement
        model.setAttack(input.valueAsNumber)
        input.value = String(model.attackMs)
    }

    const placeBank = (node: HTMLDivElement | null) => {
        if (node && bank.parentElement !== node) {
            node.replaceChildren(bank)
        }
    }

    return (
        <main>
            <h1>Beatality</h1>
            <div ref={placeBank} />
            <button id="transport" type="button" disabled={!model.hasTracks} onClick={() => model.playOrStop()}>
                {model.playLabel}
            </button>
            <label>
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
            <button id="randomize" type="button" disabled={!model.hasTracks} onClick={() => model.randomize()}>
                Randomize
            </button>
            <label>
                BPM
                <input id="bpm" type="number" step="any" defaultValue={model.bpm} onChange={onBpm} />
            </label>
            <label>
                Loop
                <input
                    id="loop"
                    type="number"
                    min={1}
                    max={32}
                    step={1}
                    defaultValue={model.loopBeats}
                    onChange={onLoop}
                />
            </label>
            <label>
                Slice
                <select id="slice" value={model.sliceExp} onChange={onSlice}>
                    {model.sliceChoices.map((choice) => (
                        <option key={choice.exponent} value={choice.exponent}>
                            {choice.label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Attack
                <input
                    id="attack"
                    type="number"
                    min={2}
                    max={16}
                    step={1}
                    defaultValue={model.attackMs}
                    onChange={onAttack}
                />
            </label>
            {model.error ? <p>{model.error}</p> : null}
        </main>
    )
}
