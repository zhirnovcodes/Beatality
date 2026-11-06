import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const processorPath = fileURLToPath(new URL('../../hosts/web/audio-thread/processor.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const tsc = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', import.meta.url))

// The worklet is one script with no imports. TypeScript 7 exposes no compiler
// API on its main entry, so the tsc binary strips the types.
function processorScript(): Plugin {
    let cached: { mtimeMs: number; code: string } | null = null

    const compile = () => {
        const mtimeMs = fs.statSync(processorPath).mtimeMs
        if (cached?.mtimeMs === mtimeMs) {
            return cached.code
        }
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beatality-processor-'))
        execFileSync(process.execPath, [
            tsc,
            '--ignoreConfig',
            processorPath,
            '--target',
            'ES2022',
            '--module',
            'ES2022',
            '--moduleResolution',
            'bundler',
            '--skipLibCheck',
            '--outDir',
            outDir,
        ])
        const code = fs.readFileSync(path.join(outDir, 'processor.js'), 'utf8')
        cached = { mtimeMs, code }
        return code
    }

    return {
        name: 'beatality-processor',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url?.split('?')[0] !== '/beatality-processor.js') {
                    next()
                    return
                }
                res.setHeader('Content-Type', 'text/javascript')
                res.end(compile())
            })
        },
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: 'beatality-processor.js', source: compile() })
        },
    }
}

const packsDir = fileURLToPath(new URL('./public/packs', import.meta.url))
const samplesDir = path.join(packsDir, 'samples')
const banksPath = path.join(packsDir, 'banks.json')

// A bare file name: no folders, no leading dot.
function safeName(name: string | null): string | null {
    if (!name || name !== path.basename(name) || name.startsWith('.') || /[\\/:*?"<>|]/.test(name)) {
        return null
    }
    return name
}

function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => resolve(Buffer.concat(chunks)))
        req.on('error', reject)
    })
}

function readBanks(): { name: string; file: string }[] {
    return JSON.parse(fs.readFileSync(banksPath, 'utf8'))
}

function writeBanks(banks: { name: string; file: string }[]) {
    fs.writeFileSync(banksPath, JSON.stringify(banks, null, 2) + '\n')
}

// The internal sample ids a pack refers to.
function packSamples(file: string): string[] {
    try {
        const doc = JSON.parse(fs.readFileSync(path.join(packsDir, file), 'utf8'))
        return (doc.tracks ?? []).filter((track: any) => track?.source?.type === 'internal').map((track: any) => String(track.source.id))
    } catch {
        return []
    }
}

// Stores the bytes under name, or under the first name-N that is free or already holds the same bytes.
function storeSample(name: string, bytes: Buffer): string {
    const ext = path.extname(name)
    const stem = name.slice(0, name.length - ext.length)
    for (let n = 1; ; n++) {
        const id = n === 1 ? name : `${stem}-${n}${ext}`
        const target = path.join(samplesDir, id)
        if (!fs.existsSync(target)) {
            fs.writeFileSync(target, bytes)
            return id
        }
        if (fs.readFileSync(target).equals(bytes)) {
            return id
        }
    }
}

// Localhost only: the dev page saves and deletes presets in public/packs. A build has no such routes.
// POST /__presets/sample?name=<file>  raw bytes  -> { id }
// POST /__presets/pack?name=<preset>  pack JSON  -> { file }
// PUT /__presets/pack?file=<file>     pack JSON  -> { ok, removedSamples }  overwrites, drops samples no preset uses now
// DELETE /__presets/pack?file=<file>             -> { ok, removedSamples }
function presetLibrary(): Plugin {
    return {
        name: 'beatality-preset-library',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url ?? '/', 'http://localhost')
                if (!url.pathname.startsWith('/__presets/')) {
                    next()
                    return
                }
                const reply = (status: number, body: unknown) => {
                    res.statusCode = status
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(body))
                }
                try {
                    if (req.method === 'POST' && url.pathname === '/__presets/sample') {
                        const name = safeName(url.searchParams.get('name'))
                        if (!name) {
                            reply(400, { error: 'bad sample name' })
                            return
                        }
                        fs.mkdirSync(samplesDir, { recursive: true })
                        reply(200, { id: storeSample(name, await readBody(req)) })
                        return
                    }
                    if (req.method === 'POST' && url.pathname === '/__presets/pack') {
                        const name = (url.searchParams.get('name') ?? '').trim()
                        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
                        if (!slug) {
                            reply(400, { error: 'bad preset name' })
                            return
                        }
                        const doc = JSON.parse((await readBody(req)).toString('utf8'))
                        if (doc?.format !== 'beatality.pack' || doc.version !== 1) {
                            reply(400, { error: 'not a pack' })
                            return
                        }
                        const file = slug + '.beatality'
                        doc.name = name
                        fs.writeFileSync(path.join(packsDir, file), JSON.stringify(doc, null, 2) + '\n')
                        const banks = readBanks().filter((bank) => bank.file !== file)
                        banks.push({ name, file })
                        writeBanks(banks)
                        reply(200, { file })
                        return
                    }
                    if ((req.method === 'DELETE' || req.method === 'PUT') && url.pathname === '/__presets/pack') {
                        const file = safeName(url.searchParams.get('file'))
                        const bank = readBanks().find((item) => item.file === file)
                        if (!file || !bank) {
                            reply(400, { error: 'no such preset' })
                            return
                        }
                        const before = packSamples(file)
                        if (req.method === 'PUT') {
                            // Update: the preset keeps its name and file, and takes the page's state.
                            const doc = JSON.parse((await readBody(req)).toString('utf8'))
                            if (doc?.format !== 'beatality.pack' || doc.version !== 1) {
                                reply(400, { error: 'not a pack' })
                                return
                            }
                            doc.name = bank.name
                            fs.writeFileSync(path.join(packsDir, file), JSON.stringify(doc, null, 2) + '\n')
                        } else {
                            fs.rmSync(path.join(packsDir, file), { force: true })
                            writeBanks(readBanks().filter((item) => item.file !== file))
                        }
                        // The samples this preset had, minus the ones any preset still uses.
                        const used = new Set(readBanks().flatMap((item) => packSamples(item.file)))
                        const orphans = before.filter((id) => !used.has(id) && safeName(id))
                        for (const id of orphans) {
                            fs.rmSync(path.join(samplesDir, id), { force: true })
                        }
                        reply(200, { ok: true, removedSamples: orphans })
                        return
                    }
                    reply(404, { error: 'unknown route' })
                } catch (error) {
                    reply(500, { error: String(error) })
                }
            })
        },
    }
}

export default defineConfig({
    plugins: [processorScript(), presetLibrary()],
    // localhost on this machine is IPv6-only unless the host is set, so a
    // browser that opens 127.0.0.1 is refused. Listen on every loopback.
    server: { host: true, port: 5173, fs: { allow: [repoRoot] } },
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                sampleBuffer: fileURLToPath(new URL('./sample-buffer.html', import.meta.url)),
                rack: fileURLToPath(new URL('./rack.html', import.meta.url)),
            },
        },
    },
})
