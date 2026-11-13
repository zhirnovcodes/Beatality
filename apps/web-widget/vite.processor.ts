import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const processorPath = fileURLToPath(new URL('../../hosts/web/audio-thread/processor.ts', import.meta.url))
const tsc = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', import.meta.url))

let cached: { mtimeMs: number; code: string } | null = null

// The worklet is one script with no imports. TypeScript 7 exposes no compiler
// API on its main entry, so the tsc binary strips the types.
export function compileProcessor(): string {
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

// Serves the worklet at fileName in dev and writes it there in a build.
export function processorScript(fileName: string): Plugin {
    return {
        name: 'beatality-processor',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url?.split('?')[0] !== '/' + fileName) {
                    next()
                    return
                }
                res.setHeader('Content-Type', 'text/javascript')
                res.end(compileProcessor())
            })
        },
        generateBundle() {
            this.emitFile({ type: 'asset', fileName, source: compileProcessor() })
        },
    }
}
