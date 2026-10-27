import { SampleBufferView, type SampleBufferNumbers } from '../../views/web/SampleBufferView'
import { VolumeDiagram } from '../../views/web/volumeDiagram'

export interface SamplePicture {
    samples: Float32Array
    right?: Float32Array
    sampleRate: number
    bpm: number
    loopBeats: number
    sliceBeats: number
    start: number
    length: number
    loop: boolean
    playheadBeats: number
}

export interface SampleFollow {
    samples: Float32Array
    right?: Float32Array
    sampleRate: number
    bpm: number
    loopBeats: number
    sliceBeats: number
}

const silent = new Float32Array(0)

// Maps a sample onto the strip. The view receives pixels, not musical time.
export class SampleBufferPresenter {
    private picture: SamplePicture | null = null
    private image: ImageBitmap | null = null
    private source: Float32Array | null = null
    private sourceRate = 0
    private sourceBpm = 0
    private sourceLoop = 0
    private buildingSamples: Float32Array | null = null
    private buildingRate = 0
    private buildingBpm = 0
    private buildingLoop = 0
    private buildToken = 0

    onEdit: ((start: number, length: number, loop: boolean) => void) | null = null

    constructor(private readonly view: SampleBufferView) {
        view.onKnobChange = (value) => {
            if (!this.picture) {
                return
            }
            this.picture.start = value
            this.publish()
            this.edited()
        }
        view.onLengthChange = (value) => {
            if (!this.picture) {
                return
            }
            this.picture.length = value
            this.publish()
            this.edited()
        }
        view.onLoopChange = (loop) => {
            if (!this.picture) {
                return
            }
            this.picture.loop = loop
            this.publish()
            this.edited()
        }
    }

    show(input: SamplePicture): void {
        this.picture = { ...input, samples: input.samples }
        this.publish()
    }

    // Tempo and audio from the page. Start, length, and the strip's Loop stay as the user left them.
    follow(input: SampleFollow): void {
        const sameAudio = this.picture?.samples === input.samples
        if (!this.picture || !sameAudio) {
            this.picture = {
                samples: input.samples,
                right: input.right,
                sampleRate: input.sampleRate,
                bpm: input.bpm,
                loopBeats: input.loopBeats,
                sliceBeats: input.sliceBeats,
                start: 0,
                length: 1,
                loop: false,
                playheadBeats: -1,
            }
            this.publish()
            return
        }
        if (
            this.picture.bpm === input.bpm &&
            this.picture.loopBeats === input.loopBeats &&
            this.picture.sliceBeats === input.sliceBeats &&
            this.picture.sampleRate === input.sampleRate
        ) {
            return
        }
        this.picture.bpm = input.bpm
        this.picture.loopBeats = input.loopBeats
        this.picture.sliceBeats = input.sliceBeats
        this.picture.sampleRate = input.sampleRate
        this.publish()
    }

    clear(): void {
        this.picture = {
            samples: silent,
            sampleRate: 48000,
            bpm: 120,
            loopBeats: 8,
            sliceBeats: 1,
            start: 0,
            length: 1,
            loop: false,
            playheadBeats: -1,
        }
        this.buildToken++
        this.buildingSamples = null
        this.source = silent
        this.image?.close()
        this.image = null
        this.view.applyImage(null)
        this.publish()
    }

    refit(): void {
        this.publish()
    }

    setPlayhead(beats: number): void {
        if (!this.picture || this.picture.playheadBeats === beats) {
            return
        }
        this.picture.playheadBeats = beats
        this.publish()
    }

    private edited(): void {
        if (!this.picture) {
            return
        }
        this.onEdit?.(this.picture.start, this.picture.length, this.picture.loop)
    }

    private publish(): void {
        const picture = this.picture
        if (!picture) {
            return
        }
        const placed = this.place(picture)
        if (picture.samples.length === 0) {
            this.buildToken++
            this.buildingSamples = null
            this.source = picture.samples
            if (this.image) {
                this.image.close()
                this.image = null
                this.view.applyImage(null)
            }
            this.view.applyNumbers(this.numbers(picture, placed))
            return
        }
        if (this.needsImage(picture)) {
            const token = ++this.buildToken
            this.buildingSamples = picture.samples
            this.buildingRate = picture.sampleRate
            this.buildingBpm = picture.bpm
            this.buildingLoop = picture.loopBeats
            void this.build(picture, placed.imageWidth, token)
        }
        this.view.applyNumbers(this.numbers(picture, placed))
    }

    private needsImage(picture: SamplePicture): boolean {
        const ready =
            picture.samples === this.source &&
            picture.sampleRate === this.sourceRate &&
            picture.bpm === this.sourceBpm &&
            picture.loopBeats === this.sourceLoop
        if (ready) {
            return false
        }
        return !(
            picture.samples === this.buildingSamples &&
            picture.sampleRate === this.buildingRate &&
            picture.bpm === this.buildingBpm &&
            picture.loopBeats === this.buildingLoop
        )
    }

    private async build(picture: SamplePicture, imageWidth: number, token: number): Promise<void> {
        const ratio = window.devicePixelRatio || 1
        const deviceWidth = Math.max(1, Math.round(imageWidth * ratio))
        const columns = Math.min(deviceWidth, VolumeDiagram.maxDevicePixels)
        const peaks = VolumeDiagram.columns(picture.samples, picture.right ?? null, columns)
        const image = await VolumeDiagram.image(peaks, imageWidth, SampleBufferView.stripHeight, ratio)
        if (token !== this.buildToken) {
            image.close()
            return
        }
        this.image?.close()
        this.image = image
        this.source = picture.samples
        this.sourceRate = picture.sampleRate
        this.sourceBpm = picture.bpm
        this.sourceLoop = picture.loopBeats
        this.view.applyImage(image)
    }

    private numbers(picture: SamplePicture, placed: Placed): SampleBufferNumbers {
        return {
            knob: picture.start,
            length: picture.length,
            imageStart: placed.imageStart,
            imageWidth: placed.imageWidth,
            loop: picture.loop,
            contentWidth: placed.contentWidth,
            highlightX: placed.highlightX,
            highlightWidth: placed.highlightWidth,
            gridWidth: placed.gridWidth,
            loopWidth: placed.loopWidth,
        }
    }

    private place(picture: SamplePicture): Placed {
        const loopWidth = this.view.loopSpan()
        const pxPerBeat = loopWidth / picture.loopBeats
        const durationSec = picture.samples.length / picture.sampleRate
        const imageWidth = durationSec * (picture.bpm / 60) * pxPerBeat
        const imageStart = SampleBufferView.offsetWidth - picture.start * imageWidth

        const sliceSec = (picture.sliceBeats * 60) / picture.bpm
        const usableSec = durationSec * (1 - picture.start)
        const maxSlices = slicesIn(usableSec, sliceSec)
        // Length 0 keeps one slice. Length 1 uses every slice the track can hold.
        const length = Math.min(1, Math.max(0, picture.length))
        const sliceCount = Math.round(length * (maxSlices - 1)) + 1
        const gridWidth = picture.sliceBeats * pxPerBeat
        const contentWidth = sliceCount * gridWidth

        const slotCount = Math.floor(picture.loopBeats / picture.sliceBeats)
        const slot = picture.playheadBeats < 0 ? -1 : Math.floor(picture.playheadBeats / picture.sliceBeats)
        const inSlot = slot >= 0 && slot < slotCount
        return {
            imageWidth,
            imageStart,
            contentWidth,
            gridWidth,
            loopWidth,
            highlightX: SampleBufferView.offsetWidth + (inSlot ? slot : 0) * gridWidth,
            highlightWidth: inSlot ? gridWidth : 0,
        }
    }
}

// Matches SliceGrid::trackSlices. A remainder under 1% of a slice is dropped.
function slicesIn(durationSec: number, sliceSec: number): number {
    const count = Math.floor(durationSec / sliceSec + 0.99)
    return count < 1 ? 1 : count
}

interface Placed {
    imageWidth: number
    imageStart: number
    contentWidth: number
    gridWidth: number
    loopWidth: number
    highlightX: number
    highlightWidth: number
}
