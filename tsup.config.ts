import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react/index.tsx" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  // react-native and the optional Expo modules are resolved by the host app's
  // bundler, never bundled in here.
  external: ["react", "react-native"],
})
