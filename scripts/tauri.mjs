import "./build-wake.mjs";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env };
const localCargo = path.join(root, ".toolchains/cargo/bin/cargo");
const hasLocalToolchain =
  existsSync(localCargo) &&
  existsSync(path.join(root, ".toolchains/rustup/toolchains"));
if (hasLocalToolchain) {
  env.CARGO_HOME = path.join(root, ".toolchains/cargo");
  env.RUSTUP_HOME = path.join(root, ".toolchains/rustup");
  env.PATH = `${path.dirname(localCargo)}:${env.PATH ?? ""}`;
}
const action = process.argv[2];
const cargoAction = ["check", "test"].includes(action);
const child = spawn(
  cargoAction ? (hasLocalToolchain ? localCargo : "cargo") : process.execPath,
  cargoAction
    ? [
        action,
        "--manifest-path",
        "src-tauri/Cargo.toml",
        ...process.argv.slice(3),
      ]
    : [
        path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
        ...process.argv.slice(2),
      ],
  { cwd: path.join(root, "apps/desktop"), env, stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(
    error.code === "ENOENT"
      ? "Rust/Cargo was not found. Install Rust with rustup, then retry. See README.md."
      : error.message,
  );
  process.exit(1);
});
child.on("exit", (code) => {
  if (code === 0 && action === "build") {
    const config = JSON.parse(
      readFileSync(
        path.join(root, "apps/desktop/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    );
    const profile = process.argv.includes("--debug") ? "debug" : "release";
    const bundle = path.join(
      root,
      `apps/desktop/src-tauri/target/${profile}/bundle/macos/${config.productName}.app`,
    );
    try {
      execFileSync(
        "codesign",
        [
          "--force",
          "--sign",
          "-",
          path.join(bundle, "Contents/Resources/native/libIrisWake.dylib"),
        ],
        { stdio: "inherit" },
      );
      execFileSync("codesign", ["--force", "--sign", "-", bundle], {
        stdio: "inherit",
      });
      execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], {
        stdio: "inherit",
      });
    } catch {
      process.exit(1);
    }
  }
  process.exit(code ?? 1);
});
