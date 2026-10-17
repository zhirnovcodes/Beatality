// Browsers start audio only after a user gesture. Call resume() from that gesture.
export class AudioUnlock {
    private context: AudioContext | null = null

    current(): AudioContext | null {
        return this.context
    }

    async resume(): Promise<AudioContext> {
        if (!this.context) {
            this.context = new AudioContext()
        }
        if (this.context.state !== 'running') {
            await this.context.resume()
        }
        return this.context
    }
}
