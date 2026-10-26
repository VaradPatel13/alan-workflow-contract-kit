import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bin: "src/cli/bin.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
});