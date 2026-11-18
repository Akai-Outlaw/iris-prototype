# Architecture

## Boundaries

React owns the interface, local presentation state, and Web Audio capture/playback. It sends validated requests to the trusted Tauri backend. Rust owns Keychain access, SQLite persistence, provider WebSockets, and the lifecycle of the managed Hermes companion. API keys never return to React.

The independent Three.js renderer uses one WebGL context, separate sky/network/orb layers, seeded geometry, and state-driven animation. Audio features come from the actual capture or scheduled playback path. The explicit demo mode supplies labeled synthetic state for visual review only.

## Hermes coordinator and specialists

The Python adapter uses Hermes AIAgent and native delegation with a version-bound restricted tool surface. A coordinator delegates to coding, research, or file-task principals. Runtime-owned child identities bind to run, role, and policy version. Model-supplied labels cannot grant authority. Built-in general tools, inherited MCP surfaces, and recursive delegation are excluded from the child surfaces.

A trusted folder selection and exact domain list define access. The policy checks grants again at execution. File changes use a complete proposed diff, content/baseline hashes, role/run/root identity, one-use expiring approval, and atomic replacement. Research retrieval permits exact HTTPS domains with public-address validation and no redirects. Coding execution is restricted to an explicit allowlist under a macOS sandbox.

These controls have isolated regression tests; they do not constitute a production security audit.

## Voice and wake

The frontend resamples microphone audio to 16 kHz mono PCM and forwards bounded frames to Deepgram through Rust. Confirmed final transcript segments are ordered and deduplicated. A 1200 ms speech endpoint triggers automatic submission for both mic-button and wake-initiated input. Capture ends after ten seconds without recognized speech and caps at thirty seconds. CloseStream drains final results before submission.

Final response text goes to ElevenLabs using the selected voice and `eleven_flash_v2_5`, requesting 24 kHz PCM. Web Audio preserves sample boundaries between packets, schedules playback, rejects stale turn chunks, and bounds the queue. A turn stays busy through gaps until the provider finishes and queued audio drains. Spoken requests trigger spoken replies independently of the typed-message auto-speech preference.

The Swift listener runs in the app process so macOS permissions belong to Iris Prototype. It verifies on-device recognition support and requires local English processing. Only adjacent whole words `hey iris` trigger activation; background transcripts are not persisted or sent to React. Detection releases its microphone before command capture begins. Wait for Listening before speaking; handoff audio is not buffered. Listening renews periodically and pauses during commands, generation, approvals, errors, and playback. Activation IDs and epochs reject stale callbacks. Each launch starts with wake listening off.

## Persistence compatibility

The prototype was originally developed under the OMNI working name. User-facing branding, source modules, runtime tools, events, and wake phrase now use Iris. The native bundle identifier `dev.akai.omni`, Keychain service `dev.akai.omni.providers`, SQLite filename `omni.sqlite3`, and browser preview storage key are intentionally retained so existing users keep their saved keys, history, and layout. These are compatibility identifiers, not the product name. New storage identifiers require a deliberate migration.

## Build and distribution

The repository excludes generated native libraries, build products, local toolchains, and account data. Native scripts compile the Swift library on the developer's Apple Silicon Mac, select Cargo from PATH or an existing local toolchain, build the Tauri app, and apply/verify a local ad-hoc signature. Public signing, notarization, and updates are not implemented.
