import { defineConfig, type Options } from "tsup"

const shared: Options = {
  format: ["esm", "cjs"],
  treeshake: true,
  sourcemap: true,
  // react-native and the optional Expo modules are resolved by the host app's
  // bundler, never bundled in here.
  external: ["react", "react-native"],
}

// The three builds run in parallel, so `npm run build` empties dist first
// rather than letting one of them clean what another just wrote.
export default defineConfig([
  // The default build, for browsers, Node and anything that isn't React
  // Native. It has no React Native or Expo imports at all, so Next.js and Vite
  // never try to resolve them (`scripts/check-web-build.mjs` holds that line).
  {
    ...shared,
    entry: { index: "src/index.ts" },
    outDir: "dist",
    dts: true,
  },
  // The React Native and Expo build: same entry, but `foo.native.ts` wins over
  // `foo.ts`, the way Metro resolves it. Published under the `react-native`
  // condition; the types are the default build's, which match by construction.
  {
    ...shared,
    entry: { index: "src/index.ts" },
    outDir: "dist/native",
    esbuildOptions(options) {
      options.resolveExtensions = [".native.ts", ".native.tsx", ".ts", ".tsx", ".js"]
    },
  },
  // The hooks. They import the client as `panelui-studio` (mapped to the
  // source in tsconfig), left external here, so the app's bundler picks the
  // web or native build for them too and there's one `StudioClient` either
  // way. No tree-shaking pass: rollup drops the "use client" directive a
  // Next.js server layout needs to render `<StudioProvider>`, and there's
  // nothing here to shake.
  {
    ...shared,
    entry: { react: "src/react/index.tsx" },
    outDir: "dist",
    dts: true,
    treeshake: false,
    external: [...(shared.external ?? []), "panelui-studio"],
  },
])
