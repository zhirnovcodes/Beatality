// Linear peaks for one track, and the bitmap a sample view slides.
// One column is the loudest sample in that span. Amplitude stays linear.
export class VolumeDiagram {
    static readonly maxDevicePixels = 8192

    static columns(samples: Float32Array, columnCount: number): Float32Array {
        const peaks = new Float32Array(Math.max(0, columnCount))
        const frames = samples.length
        if (frames === 0 || columnCount <= 0) {
            return peaks
        }
        for (let column = 0; column < columnCount; column++) {
            const start = Math.floor((column * frames) / columnCount)
            let end = Math.floor(((column + 1) * frames) / columnCount)
            if (end <= start) {
                end = start + 1
            }
            if (start >= frames) {
                continue
            }
            if (end > frames) {
                end = frames
            }
            let peak = 0
            for (let frame = start; frame < end; frame++) {
                const amplitude = Math.abs(samples[frame])
                if (amplitude > peak) {
                    peak = amplitude
                }
            }
            peaks[column] = peak > 1 ? 1 : peak
        }
        return peaks
    }

    // `width` and `height` are CSS pixels. The bitmap is stored at `pixelRatio`,
    // and capped so a long track stays a small image the view can scale up.
    static async image(
        peaks: Float32Array,
        width: number,
        height: number,
        pixelRatio: number,
    ): Promise<ImageBitmap> {
        const ratio = pixelRatio > 0 ? pixelRatio : 1
        const natural = Math.max(1, Math.round(Math.max(width, 1) * ratio))
        const deviceWidth = Math.min(natural, VolumeDiagram.maxDevicePixels)
        const deviceHeight = Math.max(1, Math.round(Math.max(height, 1) * ratio))
        const canvas = new OffscreenCanvas(deviceWidth, deviceHeight)
        const graphics = canvas.getContext('2d')
        if (!graphics) {
            throw new Error('missing canvas context')
        }
        graphics.clearRect(0, 0, deviceWidth, deviceHeight)
        graphics.fillStyle = '#111'
        const mid = deviceHeight / 2
        const columns = peaks.length
        if (columns > 0) {
            const span = deviceWidth / columns
            for (let column = 0; column < columns; column++) {
                const bar = peaks[column] * mid
                if (bar <= 0) {
                    continue
                }
                graphics.fillRect(column * span, mid - bar, Math.ceil(span), bar * 2)
            }
        }
        return createImageBitmap(canvas)
    }
}
