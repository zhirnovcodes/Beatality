// Linear peaks for one track, and the bitmap a sample view slides.
// One column is one image pixel: the average of that span's left and right peaks.
// Amplitude stays linear. Each peak is filled above and below the vertical center.
export class VolumeDiagram {
    static readonly maxDevicePixels = 8192
    static readonly ink = '#C1FD31'

    static columns(left: Float32Array, right: Float32Array | null, columnCount: number): Float32Array {
        const peaks = new Float32Array(Math.max(0, columnCount))
        const frames = left.length
        const rightChannel = right !== null && right.length === frames ? right : null
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
            let leftPeak = 0
            let rightPeak = 0
            for (let frame = start; frame < end; frame++) {
                const leftAmp = Math.abs(left[frame])
                if (leftAmp > leftPeak) {
                    leftPeak = leftAmp
                }
                if (rightChannel === null) {
                    continue
                }
                const rightAmp = Math.abs(rightChannel[frame])
                if (rightAmp > rightPeak) {
                    rightPeak = rightAmp
                }
            }
            if (rightChannel === null) {
                rightPeak = leftPeak
            }
            const average = (leftPeak + rightPeak) * 0.5
            peaks[column] = average > 1 ? 1 : average
        }
        return peaks
    }

    // `width` and `height` are CSS pixels. The bitmap is stored at `pixelRatio`,
    // and capped so a long track stays a small image the view can scale up.
    // The bitmap stays transparent. The shape is the peak filled both ways from center.
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
        const columns = peaks.length
        if (columns > 0) {
            const mid = deviceHeight / 2
            const span = deviceWidth / columns
            graphics.fillStyle = VolumeDiagram.ink
            graphics.beginPath()
            const yTop = (column: number) => mid - Math.max(peaks[column] * mid, 0.5)
            const yBottom = (column: number) => mid + Math.max(peaks[column] * mid, 0.5)
            graphics.moveTo(0, yTop(0))
            for (let column = 1; column < columns; column++) {
                graphics.lineTo(column * span, yTop(column))
            }
            graphics.lineTo(deviceWidth, yTop(columns - 1))
            graphics.lineTo(deviceWidth, yBottom(columns - 1))
            for (let column = columns - 1; column >= 0; column--) {
                graphics.lineTo(column * span, yBottom(column))
            }
            graphics.closePath()
            graphics.fill()
        }
        return createImageBitmap(canvas)
    }
}
