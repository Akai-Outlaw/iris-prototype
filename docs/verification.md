# Verification

## Historical prototype checks — November 12, 2026

The original local build passed frontend, browser, policy, and native checks on an M3 Pro / Apple Silicon Mac. A real Hermes text turn and all three specialist workflows completed with disposable fixtures and an explicitly approved public documentation domain. A generated ElevenLabs greeting was transcribed correctly by Deepgram. The project owner subsequently confirmed that the live wake/microphone and spoken-reply loop worked.

These are historical observations under the former working name. They do not establish that the renamed wake phrase has passed a new physical microphone test, nor do browser checks establish native performance or audio acceptance. No private keys, account data, voice IDs, raw audio, or personal folder contents are published as evidence.

## Iris publication checks — November 18, 2026

Current automated results and updated screenshots are recorded in `docs/evidence` after running the renamed source. The suite covers contracts/state synchronization, streamed speech lifecycle, pause-to-send behavior, isolated policy decisions, browser widgets and renderer recovery, Rust transcript collection, and the compiled native phrase matcher.

## Still requires acceptance

- Physical Hey Iris detection and complete microphone → model → spoken reply after the rename.
- Noisy rooms, device switching, extended interruption and provider failure cases.
- Sustained native frame rate, resource budgets, and battery use.
- Full keyboard, screen-reader, contrast, and text-scaling audit.
- Native approval click-through and clean-machine setup.
- Final voice identity, service access, and provider availability for each user's account.
- Public signing, notarization, updates, and other native platforms.

## Publication results

| Check | Result |
| --- | --- |
| Lockfile install and production frontend build | Pass |
| TypeScript application/audio/state tests | 14 passed |
| Disposable-root policy tests | 16 passed |
| Rust speech tests | 3 passed |
| Compiled Hey Iris matcher | 7 checks passed; no microphone activated |
| Browser widgets/renderer/state checks | 11 passed; no page/console errors |
| Hermes startup and empty-grant snapshot | Pass |
| Real coding specialist using a disposable file | Pass; identified itself as Iris and explained the read fixture |
| Native bundle and runtime/license resources | Built; source/resource hashes match |

The selected GitHub public release contains source, lockfiles, synthetic UI screenshots, and sanitized verification metadata. Credentials, local account/history databases, private planning notes, raw voice samples, toolchains, and compiled application bundles are excluded. These results do not claim physical acceptance of the renamed Hey Iris phrase.
