/**
 * Builds the publishable package into dist/: ESM JavaScript (works in Node 18+, Bun, Deno, edge and
 * the browser), type declarations, and a package.json that points at them. Publish with:
 *   bun run build && npm publish ./dist --access public
 */
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })

const built = await Bun.build({ entrypoints: [join(root, 'src/index.ts')], outdir: dist, target: 'browser', format: 'esm', minify: false, sourcemap: 'linked' })
if (!built.success) {
  for (const l of built.logs) console.error(l)
  process.exit(1)
}
const tsc = Bun.spawnSync(['bunx', 'tsc', '-p', join(root, 'tsconfig.build.json')], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1)

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
console.log('dist/ ready — publish with: npm publish ./dist --access public')
