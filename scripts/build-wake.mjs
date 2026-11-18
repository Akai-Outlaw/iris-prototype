import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error(
    "Native Iris Prototype currently requires an Apple Silicon Mac. Use npm run dev for the browser preview.",
  );
}
const root = fileURLToPath(new URL("..", import.meta.url));
const source = path.join(root, "native/WakeListener.swift"),
  directory = path.join(root, ".local/native");
const target = path.join(directory, "libIrisWake.dylib");
const hash = createHash("sha256")
  .update(readFileSync(source))
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .update(execFileSync("xcrun", ["swiftc", "--version"]))
  .digest("hex");
mkdirSync(directory, { recursive: true });
if (
  !existsSync(target) ||
  !existsSync(target + ".hash") ||
  readFileSync(target + ".hash", "utf8") !== hash
) {
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-module-cache-path",
      path.join(root, ".local/swift-cache"),
      "-target",
      "arm64-apple-macosx13.0",
      "-swift-version",
      "5",
      "-O",
      "-emit-library",
      "-module-name",
      "IrisWake",
      source,
      "-framework",
      "Speech",
      "-framework",
      "AVFoundation",
      "-o",
      target,
    ],
    { stdio: "inherit" },
  );
  writeFileSync(target + ".hash", hash);
}
