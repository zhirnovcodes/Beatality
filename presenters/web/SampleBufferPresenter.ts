import { SampleBufferView, type SampleBufferNumbers } from '../../views/web/SampleBufferView'
import { VolumeDiagram } from '../../views/web/volumeDiagram'

export interface SamplePicture {
    samples: Float32Array
    sampleRate: number
    bpm: number
    loopBeats: number
    sliceBeats: number
    start: number
    length: number
    loop: boolean
    playheadBeats: number
}

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

    constructor(private readonly view: SampleBufferView) {
        view.onKnobChange = (value) => {
            if (!this.picture) {
                return
            }
            this.picture.start = value
            this.publish()
        }
        view.onLengthChange = (value) => {
            if (!this.picture) {
                return
            }
            this.picture.length = value
            this.publish()
        }
        view.onLoopChange = (loop) => {
            if (!this.picture) {
                return
            }
            this.picture.loop = loop
            this.publish()
        }
    }

    show(input: SamplePicture): void {
        this.picture = { ...input, samples: input.samples }
        this.publish()
    }

    setPlayhead(beats: number): void {
        if (!this.picture) {
            return
        }
        this.picture.playheadBeats = beats
        this.publish()
    }

    private publish(): void {
        const picture = this.picture
        if (!picture) {
            return
        }
        const placed = this.place(picture)
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
        const peaks = VolumeDiagram.columns(picture.samples, columns)
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
        const loopWidth = SampleBufferView.pluginWidth - SampleBufferView.offsetWidth
        const pxPerBeat = loopWidth / picture.loopBeats
        const durationSec = picture.samples.length / picture.sampleRate
        const imageWidth = durationSec * (picture.bpm / 60) * pxPerBeat
        const imageStart = SampleBufferView.offsetWidth - picture.start * imageWidth

        const sliceSec = (picture.sliceBeats * 60) / picture.bpm
        const usableSec = durationSec * (1 - picture.start)
        const maxSlices = Math.max(1, Math.round(usableSec / sliceSec))
        // Length 0 keeps one slice. Length 1 uses every slice the track can hold.
        const length = Math.min(1, Math.max(0, picture.length))
        const sliceCount = Math.round(length * (maxSlices - 1)) + 1
        const gridWidth = picture.sliceBeats * pxPerBeat
        const contentWidth = sliceCount * gridWidth

        const slotCount = Math.floor(picture.loopBeats / picture.sliceBeats)
        const slot = Math.floor(picture.playheadBeats / picture.sliceBeats)
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

interface Placed {
    imageWidth: number
    imageStart: number
    contentWidth: number
    gridWidth: number
    loopWidth: number
    highlightX: number
    highlightWidth: number
}
