// Fails the build if the web output could break a web bundler, or if the
// React entry lost its "use client" directive.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const dist = new URL("../dist/", import.meta.url).pathname
const problems = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== "native") walk(path)
    } else if (/\.(c?js)$/.test(name)) {
      const code = readFileSync(path, "utf8")
      const hit = /["'](react-native|expo-[a-z-]+|@react-native-async-storage\/[a-z-]+)["']/.exec(code)
      if (hit) problems.push(`${path.slice(dist.length)} imports ${hit[1]}`)
    }
  }
}
walk(dist)

for (const file of ["react.js", "react.cjs"]) {
  // CommonJS output leads with "use strict"; both are directives, so it counts.
  if (!/^(?:"use strict";\s*)?"use client";/.test(readFileSync(join(dist, file), "utf8"))) {
    problems.push(`${file} doesn't open with "use client"`)
  }
}

const native = readFileSync(join(dist, "native/index.js"), "utf8")
if (!native.includes("expo-secure-store")) problems.push("native/index.js is missing the Expo storage")

if (problems.length) {
  console.error(`Web build check failed:\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
console.log("Web build check passed.")
