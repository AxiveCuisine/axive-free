import {readFileSync} from 'node:fs'
import path from 'node:path'
import {defineConfig} from 'tsup'

const {version} = JSON.parse(readFileSync('package.json', 'utf8')) as {version: string}

// The bundle is built twice: dist/axive.mjs (ESM) runs the portable folder via
// runtime\node.exe, and dist/axive.cjs (CommonJS) is what scripts/build-exe.mjs
// injects into Axive.exe — Node's single-executable apps only take a CJS script.
export default defineConfig({
  entry: {axive: 'src/cli.tsx'},
  format: ['esm', 'cjs'],
  target: 'node22',
  platform: 'node',
  clean: true,
  splitting: false,
  // one self-contained file — the installed app ships without node_modules
  noExternal: [/.*/],
  esbuildPlugins: [
    {
      // ink lazily imports its React-devtools bridge when DEV=true; Axive never
      // uses it, and bundling it would drag in a 128 KB chunk plus an import of
      // a package that isn't installed
      name: 'stub-ink-devtools',
      setup(build) {
        build.onResolve({filter: /^\.\/devtools\.js$/}, args =>
          args.importer.includes(`${path.sep}ink${path.sep}`) ? {path: 'ink-devtools', namespace: 'stub'} : undefined,
        )
        build.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export {}', loader: 'js'}))
      },
    },
    {
      // ink's reconciler has two top-level awaits, both only reached with
      // DEV=true (devtools bridge, package.json metadata). CommonJS can't hold
      // them, and Axive wants neither, so they become no-ops.
      name: 'ink-no-dev-await',
      setup(build) {
        build.onLoad({filter: /[\\/]ink[\\/]build[\\/]reconciler\.js$/}, args => {
          let contents = readFileSync(args.path, 'utf8')
          for (const [from, to] of [
            ["await import('./devtools.js');", 'void 0;'],
            ['const loaded = await loadPackageJson();', 'const loaded = {};'],
          ] as const) {
            if (!contents.includes(from)) throw new Error(`ink-no-dev-await: "${from}" not found — ink changed`)
            contents = contents.replace(from, to)
          }
          return {contents, loader: 'js', resolveDir: path.dirname(args.path)}
        })
      },
    },
    {
      // yoga-layout (ink's layout engine) boots its wasm with a top-level
      // await, which CommonJS can't express. Emscripten's instantiateWasm hook
      // lets us compile the same embedded wasm synchronously instead; with no
      // async step left the module is fully initialised when loadYoga returns.
      name: 'sync-yoga',
      setup(build) {
        build.onLoad({filter: /[\\/]yoga-layout[\\/]dist[\\/]src[\\/]index\.js$/}, args => {
          const dir = path.dirname(args.path)
          const binary = readFileSync(path.join(dir, '..', 'binaries', 'yoga-wasm-base64-esm.js'), 'utf8')
          const base64 = /data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/.exec(binary)?.[1]
          if (!base64) throw new Error('sync-yoga: embedded wasm not found in yoga-layout')
          return {
            resolveDir: dir,
            loader: 'js',
            contents: `
import loadYoga from '../binaries/yoga-wasm-base64-esm.js'
import wrapAssembly from './wrapAssembly.js'
const wasm = Buffer.from(${JSON.stringify(base64)}, 'base64')
const lib = {
  instantiateWasm(imports, done) {
    done(new WebAssembly.Instance(new WebAssembly.Module(wasm), imports))
    return {}
  },
}
loadYoga(lib)
if (!lib.calledRun) throw new Error('yoga-layout failed to initialise synchronously')
const Yoga = wrapAssembly(lib)
export default Yoga
export * from './generated/YGEnums.js'
`,
          }
        })
      },
    },
  ],
  esbuildOptions(options, {format}) {
    if (format === 'cjs') options.define = {...options.define, __AXIVE_DEV__: 'false'}
  },
  outExtension: ({format}) => ({js: format === 'cjs' ? '.cjs' : '.mjs'}),
  define: {
    __AXIVE_VERSION__: JSON.stringify(version),
    // the dev licence bypass and API override exist only in the ESM bundle; dist/axive.cjs (Axive.exe) is built without them
    __AXIVE_DEV__: 'true',
    'process.env.NODE_ENV': '"production"',
  },
  // bundled CommonJS deps (react) call require(); give the ESM bundle one
  banner: ({format}) =>
    format === 'esm'
      ? {js: "import {createRequire as __createRequire} from 'node:module';const require = __createRequire(import.meta.url);"}
      : {},
})
