// IvanDAW's Web Plugin API v2, copied unchanged from ivandaw-core v0.1.0 src/api.ts.
// Beatality does not depend on ivandaw-core. The v1 API in plugin.ts stays for the rack page.

export type PluginKind = 'instrument' | 'effect' | 'midi' | 'modulator' | 'utility'
export type Feature = 'state' | 'presets' | 'sample-accurate' | 'latency' | 'tail'

export interface PluginManifest {
  id: string; name: string; vendor: string; version: string
  apiVersion: 2
  kind: PluginKind
  ports: PortInfo[]
  ui: { width: number; height: number; resizable: boolean } | null   // CSS px
  features: Feature[]
}
export interface PluginFactory {
  readonly manifest: PluginManifest
  create(host: HostContext, container: HTMLElement | null): Promise<PluginInstance>
}
export interface HostContext {
  readonly audioContext: AudioContext
  readonly apiVersion: 2
  readonly slotId: string
  transport(): TransportState
  notify(level: 'info' | 'warning' | 'error', message: string): void
  markDirty(): void
  assetUrl(path: string): string                // resolved against the module URL
}
export interface PluginInstance {
  readonly ports: ReadonlyMap<string, PortHandle>
  readonly latency: number; readonly tail: number
  parameters(): ParameterInfo[]
  parameter(id: string): number                 // normalized 0..1
  schedule(events: PluginEvent[]): void
  listen(l: (e: PluginEvent) => void): () => void
  subscribe(l: (c: ParameterChange) => void): () => void
  getState(): Promise<PluginState>
  setState(s: PluginState): Promise<void>
  mount(container: HTMLElement): void
  unmount(): void
  suspend(): void; resume(): void
  dispose(): void
}
export type PortInfo =
  | { id: string; label: string; kind: 'audio'; direction: 'in' | 'out'; channels: 1 | 2; main: boolean }
  | { id: string; label: string; kind: 'events'; direction: 'in' | 'out'; accepts: EventType[] }
  | { id: string; label: string; kind: 'modulation'; direction: 'out' }
export type PortHandle =
  | { info: PortInfo & { kind: 'audio' }; node: AudioNode; index: number }
  | { info: PortInfo & { kind: 'events' | 'modulation' } }
export type EventType = 'midi' | 'automation' | 'tempo' | 'transport'
export type PluginEvent = (
  | { type: 'midi'; time: number; bytes: [number, number, number] }
  | { type: 'automation'; time: number; id: string; value: number; source?: 'host' | 'binding' | 'clip' }
  | { type: 'tempo'; time: number; bpm: number }
  | { type: 'transport'; time: number; state: TransportState }
) & { port?: string }
export interface TransportState {
  playing: boolean; bpm: number; beat: number
  numerator: number; denominator: number
  loop: { start: number; end: number } | null
}
export interface ParameterInfo {
  id: string; label: string
  kind: 'float' | 'int' | 'boolean' | 'choice' | 'trigger'
  min: number; max: number; default: number
  unit?: string; scale?: 'linear' | 'log'; choices?: string[]; group?: string
  automatable: boolean
  format?: (value: number) => string
}
export interface ParameterChange {
  id: string; value: number
  gesture?: 'begin' | 'end'
  source: 'ui' | 'host' | 'binding' | 'internal'
}
export interface PluginState {
  pluginId: string; pluginVersion: string
  data: unknown; files?: Record<string, Blob>
}
