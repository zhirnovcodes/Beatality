import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { defaultPack, manifest } from './src/dawManifest.ts'
import { processorScript } from './vite.processor.ts'

// The IvanDAW build: one folder that works from any URL. See dist-daw/ for the layout.
// index.js        the PluginFactory, Preact and CSS bundled in
// processor.js    the AudioWorklet script
// beatality.wasm
// manifest.json   the manifest as data
// packs/          banks.json, every factory preset, and the samples they use

const wasmPath = fileURLToPath(new URL('../../build-wasm/beatality.wasm', import.meta.url))
const packsDir = fileURLToPath(new URL('./public/packs', import.meta.url))
const wasmCommand = 'emcmake cmake -S . -B build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build-wasm --target beatality'

// The internal sample ids a pack refers to.
function packSamples(text: string): string[] {
    const doc = JSON.parse(text)
    return (doc.tracks ?? []).filter((track: any) => track?.source?.type === 'internal').map((track: any) => String(track.source.id))
}

function dawFiles(): Plugin {
    return {
        name: 'beatality-daw-files',
        buildStart() {
            if (!fs.existsSync(wasmPath)) {
                this.error(`build-wasm/beatality.wasm is missing. Run the wasm build first, from the repo root:\n  ${wasmCommand}`)
            }
        },
        // index.js injects the CSS itself (daw-plugin.tsx). Vite still extracts a copy after the bundle hooks run.
        writeBundle(options) {
            for (const fileName of fs.readdirSync(options.dir!)) {
                if (fileName.endsWith('.css')) {
                    fs.rmSync(path.join(options.dir!, fileName))
                }
            }
        },
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: 'beatality.wasm', source: fs.readFileSync(wasmPath) })
            this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) + '\n' })

            // Every factory preset ships. A preset's samples are fetched only when it is loaded.
            const banks: { name: string; file: string }[] = JSON.parse(fs.readFileSync(path.join(packsDir, 'banks.json'), 'utf8'))
            if (!banks.some((bank) => bank.file === defaultPack)) {
                this.error(`the default pack ${defaultPack} is not in packs/banks.json`)
            }
            this.emitFile({ type: 'asset', fileName: 'packs/banks.json', source: JSON.stringify(banks, null, 2) + '\n' })
            const samples = new Set<string>()
            for (const bank of banks) {
                const pack = fs.readFileSync(path.join(packsDir, bank.file), 'utf8')
                this.emitFile({ type: 'asset', fileName: 'packs/' + bank.file, source: pack })
                for (const id of packSamples(pack)) {
                    samples.add(id)
                }
            }
            for (const id of samples) {
                const sample = path.join(packsDir, 'samples', id)
                if (!fs.existsSync(sample)) {
                    this.error(`a preset uses a sample that is missing: packs/samples/${id}`)
                }
                this.emitFile({ type: 'asset', fileName: 'packs/samples/' + id, source: fs.readFileSync(sample) })
            }
        },
    }
}

export default defineConfig({
    plugins: [processorScript('processor.js'), dawFiles()],
    publicDir: false,
    build: {
        outDir: 'dist-daw',
        emptyOutDir: true,
        target: 'es2022',
        lib: {
            entry: fileURLToPath(new URL('./src/daw-plugin.tsx', import.meta.url)),
            formats: ['es'],
            fileName: () => 'index.js',
        },
    },
})
