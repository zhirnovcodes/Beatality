// What every web plugin exports, and what the wrapper page uses to place, wire, and close it.
// Shaped after Web Audio Modules 2.0, so a third-party WAM can be hosted through an adapter.

export interface ParameterInfo {
    id: string
    label: string
    kind: 'float' | 'int' | 'boolean'
    min: number
    max: number
}

// The project's transport. beat and seconds count from the project start, at the event's time.
export interface TransportState {
    playing: boolean
    // The project's tempo.
    bpm: number
    beat: number
    seconds: number
}

// time is in the context's seconds.
export type PluginEvent =
    | { type: 'midi'; time: number; bytes: [number, number, number] }
    // value is 0..1 across the parameter's min..max.
    | { type: 'automation'; time: number; id: string; value: number }
    // The host's tempo.
    | { type: 'tempo'; time: number; bpm: number }
    // Sent on play, stop, a jump, and a tempo change.
    | { type: 'transport'; time: number; state: TransportState }

export interface PluginInstance {
    readonly audioInput: AudioNode | null
    readonly audioOutput: AudioNode | null
    parameters(): ParameterInfo[]
    // 0..1
    parameter(id: string): number
    // Event input.
    schedule(events: PluginEvent[]): void
    // Event output. The wrapper subscribes and does all routing.
    listen(listener: (event: PluginEvent) => void): () => void
    // Parameter changes from any cause, mouse or event.
    subscribe(listener: (id: string, value: number) => void): () => void
    // A drag of sourceDragType was dropped on one of this plugin's parameters.
    onDrop(listener: (source: string, parameter: string) => void): () => void
    dispose(): void
}

export interface PluginFactory {
    readonly name: string
    create(context: AudioContext, container: HTMLElement): Promise<PluginInstance>
}

// The drag data is the source's id, as the wrapper names it.
export const sourceDragType = 'application/x-plugin-source'
