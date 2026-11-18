# Contributing

Iris Prototype is an early portfolio project. Keep changes focused and explain the user-visible behavior and relevant validation in a pull request.

For frontend work, run `npm ci`, `npm test`, and `npm run build`. For policy changes, also run `npm run test:policy`. Native voice/wake changes require an Apple Silicon Mac and the checks listed in the README. Account-backed tests must be explicitly requested and must never include credentials or private transcripts in logs.

Preserve the scope boundary: model output, transcripts, source pages, and files cannot authorize tools or widen a folder/domain grant. Proposed writes and coding checks require exact action approval. Keep the browser preview honest about unavailable native services.

Do not commit `.env` files, API keys, account data, SQLite history, local toolchains, build outputs, private audio, or personal planning documents. `python3 scripts/check-publication.py` checks staged files for common issues; it is not a complete secret scanner.

The native application retains legacy local storage identifiers to preserve existing installations. Do not rename them without an explicit migration. See architecture notes.

An original-code license has not yet been selected. Third-party notices retain their original terms.
