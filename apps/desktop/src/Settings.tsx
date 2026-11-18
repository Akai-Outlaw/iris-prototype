import { useEffect, useState } from "react";
import { command, native, safeError } from "./bridge";
import type { Quality } from "@iris/galaxy-engine";
import type { SpecialistId } from "@iris/contracts";
export type Preferences = {
  provider: "chatgpt" | "hermes";
  names: Record<SpecialistId, string>;
  voiceId: string;
  autoSpeak: boolean;
  quality: Quality;
  motion: "system" | "reduced" | "full";
  retain: boolean;
};
export const defaultPreferences: Preferences = {
  provider: "chatgpt",
  names: { coding: "Axiom", research: "Spectra", "file-task": "Umbra" },
  voiceId: "",
  autoSpeak: true,
  quality: "auto",
  motion: "system",
  retain: true,
};
type Props = {
  preferences: Preferences;
  setPreferences: (value: Preferences) => void;
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
  root: string;
  domains: string[];
  clear: () => void;
  onError: (text: string) => void;
  audition: () => void;
  auditioning: boolean;
};
export function Settings({
  preferences: p,
  setPreferences: set,
  connected,
  connect,
  disconnect,
  root,
  domains,
  clear,
  onError,
  audition,
  auditioning,
}: Props) {
  const [keys, setKeys] = useState({ deepgram: "", elevenlabs: "" }),
    [status, setStatus] = useState({ deepgram: false, elevenlabs: false }),
    [saving, setSaving] = useState(""),
    [voices, setVoices] = useState<
      { id: string; name: string; labels: Record<string, string> }[]
    >([]),
    [sources, setSources] = useState(domains.join("\n")),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (native)
      void command<typeof status>("provider_status")
        .then(setStatus)
        .catch((e) => onError(safeError(e)));
  }, []);
  const save = async (provider: "deepgram" | "elevenlabs") => {
    setSaving(provider);
    try {
      await command("save_secret", { provider, secret: keys[provider] });
      setKeys((k) => ({ ...k, [provider]: "" }));
      setStatus((s) => ({ ...s, [provider]: true }));
      setNotice("Key saved in macOS Keychain.");
    } catch (e) {
      onError(safeError(e));
    } finally {
      setSaving("");
    }
  };
  const remove = async (provider: "deepgram" | "elevenlabs") => {
    try {
      await command("remove_secret", { provider });
      setStatus((s) => ({ ...s, [provider]: false }));
      setNotice("Key removed from Keychain.");
    } catch (e) {
      onError(safeError(e));
    }
  };
  return (
    <div className="settings-content">
      {!native && (
        <div className="notice">
          Browser preview. Open Iris desktop to enter credentials and connect
          services.
        </div>
      )}
      <div className="settings-section">
        <small>01 / INTELLIGENCE</small>
        <h3>Hermes connection</h3>
        <p>
          Authentication stays with Hermes. Choose your ChatGPT sign-in or the
          provider selected in Hermes. Global Hermes settings are unchanged.
        </p>
        <label>
          Model access
          <select
            aria-label="Model access"
            value={p.provider}
            disabled={connected}
            onChange={(e) =>
              set({ ...p, provider: e.target.value as Preferences["provider"] })
            }
          >
            <option value="chatgpt">Existing ChatGPT sign-in</option>
            <option value="hermes">Hermes configured provider</option>
          </select>
        </label>
        <div className="settings-inline">
          <span className={`pill ${connected ? "connected" : ""}`}>
            {connected ? "Connected" : "Disconnected"}
          </span>
          <button
            className="secondary"
            onClick={connected ? disconnect : connect}
            disabled={!native}
          >
            {connected ? "Disconnect" : "Connect Hermes"}
          </button>
        </div>
      </div>
      <div className="settings-section">
        <small>02 / VOICE PROVIDERS</small>
        <h3>Give Iris a voice</h3>
        <p>
          Keys stay in macOS Keychain. Deepgram processes your speech;
          ElevenLabs receives the text to speak.
        </p>
        {(["deepgram", "elevenlabs"] as const).map((provider) => (
          <div className="provider-field" key={provider}>
            <label htmlFor={provider}>
              {provider === "deepgram"
                ? "Deepgram · speech recognition"
                : "ElevenLabs · voice output"}
              <span>{status[provider] ? "Key saved" : "Not configured"}</span>
            </label>
            <div className="input-action">
              <input
                id={provider}
                type="password"
                autoComplete="off"
                spellCheck={false}
                disabled={!native}
                value={keys[provider]}
                onChange={(e) =>
                  setKeys((k) => ({ ...k, [provider]: e.target.value }))
                }
                placeholder="Enter API key"
              />
              <button
                className="secondary"
                disabled={!native || !keys[provider].trim() || !!saving}
                onClick={() => void save(provider)}
              >
                {saving === provider ? "Saving…" : "Save"}
              </button>
            </div>
            {status[provider] && (
              <button
                className="text-button"
                onClick={() => void remove(provider)}
              >
                Remove saved key
              </button>
            )}
          </div>
        ))}
        <label htmlFor="voice-id">
          IRIS voice ID <span className="muted">British female voice</span>
        </label>
        <input
          id="voice-id"
          autoComplete="off"
          value={p.voiceId}
          onChange={(e) => set({ ...p, voiceId: e.target.value.trim() })}
          placeholder="Choose a voice or enter its ID"
        />
        <button
          className="secondary full"
          disabled={!native || !status.elevenlabs}
          onClick={() =>
            void command<typeof voices>("list_voices")
              .then(setVoices)
              .catch((e) => onError(safeError(e)))
          }
        >
          Load voices from my account
        </button>
        {!!voices.length && (
          <label>
            Available voices
            <select
              value={p.voiceId}
              onChange={(e) => set({ ...p, voiceId: e.target.value })}
            >
              <option value="">Select a British female voice</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {Object.values(v.labels ?? {}).join(" / ")}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="secondary full"
          disabled={!native || !status.elevenlabs || !p.voiceId}
          onClick={audition}
        >
          {auditioning ? "Stop voice test" : "Audition selected voice"}
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={p.autoSpeak}
            onChange={(e) => set({ ...p, autoSpeak: e.target.checked })}
          />
          Speak typed-message replies automatically
        </label>
        <p className="muted">
          ElevenLabs needs Text to Speech access. Enable Voices read permission
          to browse voices. You can also enter a voice ID and audition it
          directly.
        </p>
      </div>
      <div className="settings-section">
        <small>03 / ACCESS</small>
        <h3>Selected project only</h3>
        <p className="path">{root || "No folder access granted"}</p>
        <div className="settings-inline">
          <button
            className="secondary"
            disabled={!connected}
            onClick={() =>
              void command("choose_root").catch((e) => onError(safeError(e)))
            }
          >
            Select folder
          </button>
          {root && (
            <button
              className="text-button"
              onClick={() =>
                void command("runtime_command", {
                  request: { command: "revoke_root" },
                }).catch((e) => onError(safeError(e)))
              }
            >
              Revoke access
            </button>
          )}
        </div>
        <label htmlFor="source-domains">Approved research domains</label>
        <textarea
          id="source-domains"
          rows={3}
          value={sources}
          placeholder={"example.org\ndocs.example.com"}
          onChange={(e) => setSources(e.target.value)}
        />
        <button
          className="secondary"
          disabled={!connected}
          onClick={() =>
            void command("runtime_command", {
              request: {
                command: "grant_domains",
                domains: sources
                  .split(/[\s,]+/)
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean),
              },
            })
              .then(() => setNotice("Research source request submitted."))
              .catch((e) => onError(safeError(e)))
          }
        >
          Apply domains
        </button>
        <p className="muted">
          Exact domains only. Every file change and check requires approval.
          Folder grants reset on disconnect.
        </p>
      </div>
      <div className="settings-section">
        <small>04 / APPEARANCE & PRIVACY</small>
        <div className="settings-grid">
          <label>
            Rendering quality
            <select
              aria-label="Rendering quality"
              value={p.quality}
              onChange={(e) =>
                set({ ...p, quality: e.target.value as Quality })
              }
            >
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            Motion
            <select
              aria-label="Motion"
              value={p.motion}
              onChange={(e) =>
                set({ ...p, motion: e.target.value as Preferences["motion"] })
              }
            >
              <option value="system">Follow system</option>
              <option value="reduced">Reduced motion</option>
              <option value="full">Full motion</option>
            </select>
          </label>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={p.retain}
            onChange={(e) => set({ ...p, retain: e.target.checked })}
          />
          Remember conversations and factual activity locally
        </label>
        <p>
          Raw microphone audio is never saved. Model requests use your Hermes
          provider.
        </p>
        <button className="secondary danger" onClick={clear}>
          Clear Iris history
        </button>
      </div>
      <div className="settings-section">
        <small>05 / SPECIALISTS</small>
        <h3>Make the names yours</h3>
        <p>
          Names are display preferences. Roles and permissions stay bound to
          stable specialist IDs.
        </p>
        {(["coding", "research", "file-task"] as const).map((id) => (
          <label key={id}>
            {id === "coding"
              ? "Coding"
              : id === "research"
                ? "Research"
                : "Files & Tasks"}{" "}
            name
            <input
              maxLength={24}
              value={p.names[id]}
              onChange={(e) =>
                set({ ...p, names: { ...p.names, [id]: e.target.value } })
              }
            />
          </label>
        ))}
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
