/**
 * Builds @getera/brain into dist/: one ESM file (the SDK's client + brain namespace, inlined —
 * no dependency on the full @getera/sdk) and one bundled .d.ts. Publish with:
 *   bun run build && npm publish ./dist --access public
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = join(root, '..', 'era-sdk', 'src')
const dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const built = await Bun.build({ entrypoints: [join(root, 'src/index.ts')], outdir: dist, target: 'browser', format: 'esm', minify: false, sourcemap: 'linked' })
if (!built.success) {
  for (const l of built.logs) console.error(l)
  process.exit(1)
}

// Types: the two SDK files the entry re-exports, then the entry — one self-contained index.d.ts.
const strip = (src: string) =>
  src
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export (type )?\* from[^\n]*\n/gm, '')
    .replace(/^export \{ EraError \}\n/m, '')
    .replace(/^export type \{ EraOptions \}\n/m, '')
const tmp = join(root, '.dts-tmp.ts')
writeFileSync(tmp, [strip(readFileSync(join(sdk, 'client.ts'), 'utf8')), strip(readFileSync(join(sdk, 'brain.ts'), 'utf8')), strip(readFileSync(join(root, 'src/index.ts'), 'utf8'))].join('\n'))
const tsc = Bun.spawnSync(['bunx', 'tsc', tmp, '--declaration', '--emitDeclarationOnly', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--lib', 'ES2022,DOM', '--skipLibCheck', '--strict', '--outDir', dist], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
rmSync(tmp, { force: true })
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1)
const dts = join(dist, '.dts-tmp.d.ts')
writeFileSync(join(dist, 'index.d.ts'), readFileSync(dts, 'utf8'))
rmSync(dts, { force: true })

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
delete pkg.scripts
delete pkg.devDependencies
pkg.exports = { '.': { types: './index.d.ts', import: './index.js', default: './index.js' } }
pkg.main = './index.js'
pkg.types = './index.d.ts'
pkg.files = ['*.js', '*.js.map', '*.d.ts', 'README.md', 'LICENSE']
pkg.sideEffects = false
writeFileSync(join(dist, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
for (const f of ['README.md', 'LICENSE']) if (existsSync(join(root, f))) copyFileSync(join(root, f), join(dist, f))
console.log(`dist/ ready (${(readFileSync(join(dist, 'index.js')).length / 1024).toFixed(1)} KB) — publish with: npm publish ./dist --access public`)
