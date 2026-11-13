import type { PluginManifest } from '../../../hosts/web/plugin-v2'

// Plain data, so the DAW build can also write it out as manifest.json.
export const manifest: PluginManifest = {
    id: 'com.beatality.beatality',
    name: 'Beatality',
    vendor: 'zhirnovcodes',
    // The JUCE plugin's version.
    version: '0.0.1',
    apiVersion: 2,
    kind: 'instrument',
    ports: [
        { id: 'in', label: 'Events', kind: 'events', direction: 'in', accepts: ['midi', 'automation', 'tempo', 'transport'] },
        { id: 'out', label: 'Output', kind: 'audio', direction: 'out', channels: 2, main: true },
    ],
    // The skin is 496 px, with 24 px of margin and 226 px more when the CHAOS drawer is open.
    ui: { width: 746, height: 638, resizable: false },
    features: ['state'],
}

// The pack a new instance loads. The user picks any other factory preset in the widget's bank picker.
export const defaultPack = 'xolotl-drums-115-bpm.beatality'
