const wavOrMp3 = /\.(wav|mp3)$/i

export class SampleDecoder {
    constructor(private readonly context: AudioContext) {}

    accepts(file: File): boolean {
        return wavOrMp3.test(file.name)
    }

    // Null when the file is the wrong type or the browser cannot decode it.
    async decode(file: File): Promise<AudioBuffer | null> {
        if (!this.accepts(file)) {
            return null
        }
        try {
            const encoded = await file.arrayBuffer()
            const audio = await this.context.decodeAudioData(encoded)
            return audio.length > 0 ? audio : null
        } catch {
            return null
        }
    }
}

// Interleaved stereo is not what the core reads. Left samples, then right samples.
// A mono file is copied to both channels.
export function toPlanarStereo(audio: AudioBuffer): Float32Array {
    const frames = audio.length
    const planar = new Float32Array(frames * 2)
    const left = audio.getChannelData(0)
    planar.set(left, 0)
    planar.set(audio.numberOfChannels > 1 ? audio.getChannelData(1) : left, frames)
    return planar
}
