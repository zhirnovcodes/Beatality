export interface SampleBufferNumbers {
    knob: number
    length: number
    imageStart: number
    imageWidth: number
    loop: boolean
    contentWidth: number
    highlightX: number
    highlightWidth: number
    gridWidth: number
    loopWidth: number
}

// The strip and its controls. Numbers and the bitmap are applied separately.
export class SampleBufferView {
    static readonly offsetWidth = 20
    static readonly pluginWidth = 640
    static readonly stripHeight = 80

    onKnobChange: (value: number) => void = () => {}
    onLengthChange: (value: number) => void = () => {}
    onLoopChange: (loop: boolean) => void = () => {}

    private readonly canvas: HTMLCanvasElement
    private readonly context: CanvasRenderingContext2D
    private readonly paper: HTMLElement
    private readonly highlight: HTMLElement
    private readonly grid: HTMLElement
    private readonly frame: HTMLElement
    private readonly name: HTMLElement
    private readonly strip: HTMLElement
    private readonly knob: HTMLInputElement
    private readonly lengthSlider: HTMLInputElement
    private readonly loopToggle: HTMLInputElement
    private numbers: SampleBufferNumbers | null = null
    private image: ImageBitmap | null = null
    private gridKey = Number.NaN
    private painted: {
        image: ImageBitmap | null
        imageStart: number
        imageWidth: number
        contentWidth: number
        loop: boolean
        loopWidth: number
    } | null = null

    constructor(host: HTMLElement) {
        const root = document.createElement('div')
        root.className = 'sample-buffer'

        this.strip = document.createElement('div')
        this.strip.className = 'sample-buffer-strip'
        this.strip.style.width = `${SampleBufferView.pluginWidth}px`
        this.strip.style.height = `${SampleBufferView.stripHeight}px`

        this.paper = document.createElement('div')
        this.paper.className = 'sample-buffer-paper'

        this.canvas = document.createElement('canvas')
        this.canvas.className = 'sample-buffer-wave'
        const context = this.canvas.getContext('2d')
        if (!context) {
            throw new Error('missing canvas context')
        }
        this.context = context

        this.highlight = document.createElement('div')
        this.highlight.className = 'sample-buffer-highlight'

        this.grid = document.createElement('div')
        this.grid.className = 'sample-buffer-grid'

        this.frame = document.createElement('div')
        this.frame.className = 'sample-buffer-frame'

        this.name = document.createElement('div')
        this.name.className = 'sample-buffer-name'

        this.strip.append(this.paper, this.canvas, this.highlight, this.grid, this.frame, this.name)

        const controls = document.createElement('div')
        controls.className = 'sample-buffer-controls'

        const startLabel = document.createElement('label')
        startLabel.textContent = 'Start'
        this.knob = document.createElement('input')
        this.knob.className = 'sample-buffer-knob'
        this.knob.type = 'range'
        this.knob.min = '0'
        this.knob.max = '1'
        this.knob.step = '0.001'
        this.knob.value = '0'
        this.knob.addEventListener('input', () => {
            this.onKnobChange(Number(this.knob.value))
        })
        startLabel.append(this.knob)

        const lengthLabel = document.createElement('label')
        lengthLabel.textContent = 'Length'
        this.lengthSlider = document.createElement('input')
        this.lengthSlider.className = 'sample-buffer-length'
        this.lengthSlider.type = 'range'
        this.lengthSlider.min = '0'
        this.lengthSlider.max = '1'
        this.lengthSlider.step = '0.001'
        this.lengthSlider.value = '1'
        this.lengthSlider.addEventListener('input', () => {
            this.onLengthChange(Number(this.lengthSlider.value))
        })
        lengthLabel.append(this.lengthSlider)

        const loopLabel = document.createElement('label')
        loopLabel.append(document.createTextNode('Loop'))
        this.loopToggle = document.createElement('input')
        this.loopToggle.className = 'sample-buffer-loop'
        this.loopToggle.type = 'checkbox'
        this.loopToggle.addEventListener('change', () => {
            this.onLoopChange(this.loopToggle.checked)
        })
        loopLabel.append(this.loopToggle)

        controls.append(startLabel, lengthLabel, loopLabel)
        root.append(this.strip, controls)
        host.append(root)
    }

    setName(name: string): void {
        this.name.textContent = name
    }

    // Width of the loop window. Uses the slot once the strip is on the page.
    loopSpan(): number {
        const width = this.strip.parentElement?.clientWidth ?? 0
        const full = width > 0 ? width : SampleBufferView.pluginWidth
        return Math.max(1, full - SampleBufferView.offsetWidth)
    }

    applyNumbers(settings: SampleBufferNumbers): void {
        this.numbers = settings
        const frameLeft = SampleBufferView.offsetWidth
        const frameWidth = settings.loopWidth
        this.strip.style.width = `${frameLeft + frameWidth}px`
        this.strip.style.height = `${SampleBufferView.stripHeight}px`

        for (const edge of [this.paper, this.grid, this.frame]) {
            edge.style.left = `${frameLeft}px`
            edge.style.width = `${frameWidth}px`
        }

        if (settings.highlightWidth > 0) {
            this.highlight.style.display = 'block'
            this.highlight.style.left = `${settings.highlightX}px`
            this.highlight.style.width = `${settings.highlightWidth}px`
        } else {
            this.highlight.style.display = 'none'
        }

        this.paintGrid(settings.gridWidth, frameWidth)
        this.paintWave()

        if (Number(this.knob.value) !== settings.knob) {
            this.knob.value = String(settings.knob)
        }
        if (Number(this.lengthSlider.value) !== settings.length) {
            this.lengthSlider.value = String(settings.length)
        }
        if (this.loopToggle.checked !== settings.loop) {
            this.loopToggle.checked = settings.loop
        }
    }

    applyImage(image: ImageBitmap | null): void {
        this.image = image
        this.paintWave()
    }

    private paintGrid(gridWidth: number, frameWidth: number): void {
        if (!(gridWidth > 0)) {
            this.grid.style.backgroundImage = 'none'
            this.gridKey = Number.NaN
            return
        }
        if (gridWidth === this.gridKey) {
            return
        }
        this.gridKey = gridWidth
        const ratio = window.devicePixelRatio || 1
        const tile = document.createElement('canvas')
        tile.width = Math.max(1, Math.round(gridWidth * ratio))
        tile.height = Math.max(1, Math.round(SampleBufferView.stripHeight * ratio))
        const graphics = tile.getContext('2d')
        if (!graphics) {
            return
        }
        graphics.clearRect(0, 0, tile.width, tile.height)
        graphics.fillStyle = '#000'
        graphics.fillRect(0, 0, Math.max(1, Math.round(ratio)), tile.height)
        this.grid.style.backgroundImage = `url(${tile.toDataURL()})`
        this.grid.style.backgroundRepeat = 'repeat-x'
        this.grid.style.backgroundSize = `${gridWidth}px ${SampleBufferView.stripHeight}px`
        this.grid.style.width = `${frameWidth}px`
    }

    private paintWave(): void {
        const settings = this.numbers
        if (!settings) {
            return
        }
        const image = this.image
        const painted = this.painted
        if (
            painted !== null &&
            painted.image === image &&
            painted.imageStart === settings.imageStart &&
            painted.imageWidth === settings.imageWidth &&
            painted.contentWidth === settings.contentWidth &&
            painted.loop === settings.loop &&
            painted.loopWidth === settings.loopWidth
        ) {
            return
        }
        this.painted = {
            image,
            imageStart: settings.imageStart,
            imageWidth: settings.imageWidth,
            contentWidth: settings.contentWidth,
            loop: settings.loop,
            loopWidth: settings.loopWidth,
        }

        const ratio = window.devicePixelRatio || 1
        const width = SampleBufferView.offsetWidth + settings.loopWidth
        const height = SampleBufferView.stripHeight
        const deviceWidth = Math.max(1, Math.round(width * ratio))
        const deviceHeight = Math.max(1, Math.round(height * ratio))
        if (this.canvas.width !== deviceWidth || this.canvas.height !== deviceHeight) {
            this.canvas.width = deviceWidth
            this.canvas.height = deviceHeight
        }
        this.canvas.style.width = `${width}px`
        this.canvas.style.height = `${height}px`

        const ctx = this.context
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, deviceWidth, deviceHeight)
        if (!image || !(settings.imageWidth > 0)) {
            return
        }

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        ctx.save()
        const origin = SampleBufferView.offsetWidth
        const frameRight = origin + settings.loopWidth
        ctx.beginPath()
        ctx.rect(origin, 0, settings.loopWidth, height)
        ctx.clip()

        // File time 0 sits at imageStart, left of the frame. That lead stays unpainted.
        const lead = Math.max(0, origin - settings.imageStart)
        const audioAfter = Math.max(0, settings.imageWidth - lead)
        const drawWidth = Math.min(Math.max(0, settings.contentWidth), audioAfter)
        const paintTile = (destX: number) => {
            this.drawSource(ctx, image, settings.imageWidth, lead, drawWidth, destX, height)
        }
        if (settings.loop && settings.contentWidth > 0) {
            const tiles = Math.ceil(settings.loopWidth / settings.contentWidth) + 1
            for (let tile = 0; tile < tiles; tile++) {
                const destX = origin + tile * settings.contentWidth
                if (destX >= frameRight) {
                    break
                }
                paintTile(destX)
            }
        } else {
            paintTile(origin)
        }
        ctx.restore()
    }

    private drawSource(
        ctx: CanvasRenderingContext2D,
        image: ImageBitmap,
        imageWidth: number,
        cssX: number,
        cssWidth: number,
        destX: number,
        destHeight: number,
    ): void {
        if (!(cssWidth > 0) || !(imageWidth > 0)) {
            return
        }
        const srcX = Math.min(image.width, Math.max(0, (cssX / imageWidth) * image.width))
        const srcW = Math.min(image.width - srcX, (cssWidth / imageWidth) * image.width)
        if (!(srcW > 0)) {
            return
        }
        ctx.drawImage(image, srcX, 0, srcW, image.height, destX, 0, cssWidth, destHeight)
    }
}
