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

export default defineConfig({
    plugins: [processorScript()],
    // localhost on this machine is IPv6-only unless the host is set, so a
    // browser that opens 127.0.0.1 is refused. Listen on every loopback.
    server: { host: true, port: 5173, fs: { allow: [repoRoot] } },
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                sampleBuffer: fileURLToPath(new URL('./sample-buffer.html', import.meta.url)),
            },
        },
    },
})
