# Security and privacy

This is a local development prototype, not a security-audited production assistant.

## Intended boundaries

- Provider API keys are stored in macOS Keychain, not frontend environment files.
- Wake recognition requires on-device English support and does not fall back to cloud wake processing. Only fixed wake/status events leave the native listener.
- After voice activation, command audio is sent to Deepgram. Response text is sent to ElevenLabs for speech. Model requests are handled through the configured Hermes provider.
- Optional conversations, activity, preferences, and layout are stored in local SQLite. User-selected retention and clear-history controls apply to Iris data. Hermes and providers manage their own accounts and retention separately.
- Folder access comes from the native picker; research uses exact approved domains. Runtime policy validates execution-time identity and grants.
- Proposed file writes and supported coding checks require a specific, expiring approval. Traversal, symlink escape, secret paths, and private network destinations are restricted.
- Browser preview does not accept provider keys or connect native services.

## Reporting issues

Do not post credentials, private transcripts, or an exploitable personal configuration in a public issue. Use GitHub's private vulnerability reporting feature if enabled, or contact the repository owner privately through an available GitHub profile channel. General reproduction steps with synthetic fixtures are suitable for public issues.

If a credential is exposed, revoke it at its provider. Removing a file in a later commit does not remove it from Git history.
