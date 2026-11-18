import { useCallback, useEffect, useRef, useState } from "react";
import { GalaxyEngine } from "@iris/galaxy-engine";
import {
  agents,
  type OrbState,
  type AudioFeatures,
  type SpecialistId,
} from "@iris/contracts";
import { stateTargets } from "@iris/design-tokens";
import { useIris } from "./useIris";
import { Settings } from "./Settings";
import { Window } from "./Window";
import { Icon } from "./Icon";
import { defaultLayout, widgetNames, type WidgetId } from "./layout";
import { native, command } from "./bridge";
import { MessageText } from "./MessageText";
const icons: Record<WidgetId, string> = {
  conversation: "chat",
  activity: "activity",
  specialists: "agents",
  approvals: "shield",
  artifacts: "folder",
  settings: "settings",
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
export function App() {
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<GalaxyEngine | null>(null),
    input = useRef<HTMLTextAreaElement>(null),
    end = useRef<HTMLDivElement>(null);
  const features = useCallback(
      (value: AudioFeatures) => engine.current?.setAudioFeatures(value),
      [],
    ),
    h = useIris(features);
  const [immersive, setImmersive] = useState(false),
    [webgl, setWebgl] = useState(true),
    [systemReduced, setSystemReduced] = useState(false),
    [stats, setStats] = useState({
      fps: 0,
      quality: "high",
      geometries: 0,
      contexts: 1,
    }),
    [demoState, setDemoState] = useState<OrbState>("idle"),
    [demoAudio, setDemoAudio] = useState(false),
    [confirmClear, setConfirmClear] = useState(false);
  const query = new URLSearchParams(location.search),
    demo = query.get("demo") === "1",
    freeze = (demo || import.meta.env.DEV) && query.has("freeze"),
    layer = demo || import.meta.env.DEV ? Number(query.get("layer") ?? 5) : 5;
  const reduced =
      h.preferences.motion === "reduced" ||
      (h.preferences.motion === "system" && systemReduced),
    state = demo ? demoState : h.state;
  const open = useCallback(
    (id: WidgetId) => {
      setImmersive(false);
      h.open(id);
    },
    [h.open],
  );
  const selectAgent = useCallback(
    (id: SpecialistId) => {
      h.setSelected(id);
      open("specialists");
    },
    [open],
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSystemReduced(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    try {
      const renderer = new GalaxyEngine(
        canvas.current!,
        selectAgent,
        freeze,
        layer,
        demo,
      );
      renderer.onAvailability = setWebgl;
      engine.current = renderer;
      const resize = () =>
        renderer.resize(innerWidth, innerHeight, devicePixelRatio);
      resize();
      addEventListener("resize", resize);
      return () => {
        removeEventListener("resize", resize);
        renderer.dispose();
        engine.current = null;
      };
    } catch {
      setWebgl(false);
    }
  }, [selectAgent]);
  useEffect(() => engine.current?.setState(state), [state]);
  useEffect(
    () => engine.current?.setAgents(h.agentViews),
    [h.tasks, h.selected],
  );
  useEffect(
    () => engine.current?.setQuality(h.preferences.quality),
    [h.preferences.quality],
  );
  useEffect(() => engine.current?.setReducedMotion(reduced), [reduced]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (engine.current) setStats(engine.current.stats());
    }, 1500);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!demo || !demoAudio) return;
    let frame = 0;
    const update = () => {
      const now = performance.now(),
        energy = Math.max(0, Math.sin(now * 0.009)) * 0.6;
      features({
        source: "demo",
        level: energy,
        bass: energy * 0.7,
        treble: energy * 0.4,
        timestampMs: now,
        available: true,
      });
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [demo, demoAudio]);
  useEffect(() => {
    if (h.messages.length || h.transcript)
      end.current?.scrollIntoView({
        block: "end",
        behavior: reduced ? "instant" : "smooth",
      });
  }, [h.messages, h.transcript]);
  const selected = h.agentViews.find((agent) => agent.id === h.selected);
  const busy = h.generating || h.submitting;
  return (
    <main className={`app ${immersive ? "immersive" : ""}`} data-state={state}>
      <canvas
        ref={canvas}
        aria-label="Iris Living Galaxy: abstract wireframe sphere and three specialist satellites"
      />
      {!webgl && (
        <div className="static-fallback">
          <div className="fallback-orb">◉</div>
          <p>Static view · WebGL unavailable</p>
        </div>
      )}
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setImmersive(false);
          }}
          aria-label="Iris dashboard"
        >
          <div className="brand-mark">
            <i />
            <i />
            <i />
          </div>
          <span>
            IRIS<small>PROTOTYPE / VERSION 01</small>
          </span>
        </a>
        <nav aria-label="Display mode">
          <button
            className={!immersive ? "active" : ""}
            onClick={() => setImmersive(false)}
          >
            <Icon name="grid" size={14} />
            Dashboard
          </button>
          <button
            className={immersive ? "active" : ""}
            onClick={() => setImmersive(true)}
          >
            <Icon name="eye" size={15} />
            Immersive
          </button>
        </nav>
        <div className="top-actions">
          <button
            className={`connection ${h.connection}`}
            disabled={h.connection === "connecting" || demo}
            onClick={() =>
              native && h.connection === "disconnected"
                ? void h.connect()
                : open("settings")
            }
            title={h.detail}
          >
            <span className="status-dot" />
            {h.connection === "connected"
              ? "Hermes connected"
              : h.connection === "connecting"
                ? "Connecting Hermes"
                : "Hermes disconnected"}
          </button>
          {h.approvals.length > 0 && (
            <button
              className="approval-indicator"
              onClick={() => open("approvals")}
            >
              <Icon name="shield" size={14} />
              {h.approvals.length} approval
            </button>
          )}
          <button
            className="avatar"
            onClick={() => open("settings")}
            aria-label="Open settings"
          >
            IR
          </button>
        </div>
      </header>
      {!immersive && (
        <div className="welcome">
          <div className="eyebrow">
            <span />
            PERSONAL INTELLIGENCE, IN ORBIT
          </div>
          <h1>
            Good{" "}
            {new Date().getHours() < 12
              ? "morning"
              : new Date().getHours() < 18
                ? "afternoon"
                : "evening"}
            .
          </h1>
          <p>
            A little clarity. A wider perspective.
            <br />
            What shall we work on?
          </p>
          <button className="quiet-link" onClick={() => open("settings")}>
            Configure your workspace <Icon name="arrow" size={13} />
          </button>
        </div>
      )}
      <div className="orb-caption" aria-live="polite">
        <div className="eyebrow">
          {demo ? "LABORATORY / DEMO" : state.toUpperCase()}
        </div>
        <h2>{stateTargets[state].label}</h2>
        <p>
          {demo
            ? "Visual fixtures · Not assistant activity"
            : h.connection === "connected"
              ? "Your assistant, with a universe of perspective."
              : "Your galaxy is ready. Connect Hermes to begin."}
        </p>
        <div className="satellite-access" aria-label="Select specialist">
          {h.agentViews.map((agent) => (
            <button
              key={agent.id}
              className={agent.selected ? "selected" : ""}
              onClick={() => selectAgent(agent.id)}
              title={`${agent.name} · ${agent.role} · ${agent.status ?? "unassigned"}`}
            >
              <span className={`agent-dot ${agent.id}`} />
              {agent.name}
            </button>
          ))}
        </div>
      </div>
      {demo && (
        <aside className="demo-controls">
          <strong>DEMO / synthetic fixtures</strong>
          <label>
            Orb state
            <select
              value={demoState}
              onChange={(e) => setDemoState(e.target.value as OrbState)}
            >
              {Object.keys(stateTargets).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={demoAudio}
              onChange={(e) => setDemoAudio(e.target.checked)}
            />
            Synthetic audio envelope
          </label>
          <p>Provider and tool controls are disabled.</p>
        </aside>
      )}
      {(Object.keys(widgetNames) as WidgetId[]).map((id) => (
        <Window
          key={id}
          id={id}
          layout={h.layout[id]}
          update={h.updateWindow}
          hidden={immersive}
        >
          {id === "conversation" && (
            <>
              <div className="chat-scroll">
                {!h.messages.length && (
                  <div className="empty-chat">
                    <div className="mini-orb" />
                    <small>THE CONVERSATION STARTS HERE</small>
                    <h3>
                      A thought. A task.
                      <br />A place to begin.
                    </h3>
                    <p>
                      Bring your questions, projects, or next idea. Iris
                      coordinates the details.
                    </p>
                    <div className="suggestions">
                      {[
                        "Explain a JavaScript project",
                        "Research a topic with sources",
                        "Organize a selected folder",
                      ].map((value, i) => (
                        <button
                          key={value}
                          onClick={() => {
                            h.setText(value);
                            h.setSelected(agents[i].id);
                            input.current?.focus();
                          }}
                        >
                          <Icon
                            name={["code", "search", "folder"][i]}
                            size={13}
                          />
                          {value}
                          <Icon name="arrow" size={11} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {h.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`message ${message.role}`}
                  >
                    <div>
                      <span>{message.role === "user" ? "YOU" : "Iris"}</span>
                      <time>{time(message.createdAt)}</time>
                      {message.incomplete && <small>Streaming</small>}
                    </div>
                    <p>
                      <MessageText text={message.text} onError={h.fail} />
                    </p>
                  </article>
                ))}
                {h.transcript && (
                  <div className="transcript">
                    <small>LIVE TRANSCRIPT · NOT SUBMITTED</small>
                    <p>{h.transcript}</p>
                    <button
                      className="text-button"
                      onClick={() => {
                        h.setText(h.transcript);
                        h.setTranscript("");
                        input.current?.focus();
                      }}
                    >
                      Edit as text
                    </button>
                  </div>
                )}
                {h.generating && (
                  <p className="working">
                    <span />
                    Hermes is processing your request{" "}
                    <button
                      className="text-button"
                      onClick={() =>
                        void command("runtime_command", {
                          request: { command: "cancel" },
                        }).catch(h.fail)
                      }
                    >
                      Cancel task
                    </button>
                  </p>
                )}
                <div ref={end} />
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!demo) void h.send();
                }}
              >
                <textarea
                  ref={input}
                  aria-label="Message Iris"
                  rows={2}
                  placeholder={
                    h.connection === "connected"
                      ? "Ask Iris anything…"
                      : "Connect Hermes to start a conversation…"
                  }
                  value={h.text}
                  onChange={(e) => h.setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      if (!demo) void h.send();
                    }
                  }}
                />
                <div className="composer-bottom">
                  <span>
                    Enter to send <b>·</b> Shift + Enter for a new line
                  </span>
                  <button
                    className="send"
                    type="submit"
                    disabled={
                      !h.text.trim() ||
                      h.connection !== "connected" ||
                      busy ||
                      demo
                    }
                    aria-label="Send message"
                  >
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              </form>
            </>
          )}
          {id === "specialists" && (
            <div className="agent-list">
              <div className="panel-kicker">
                <span>THREE PERSPECTIVES. ONE ASSISTANT.</span>
                <span className="tiny-number">03</span>
              </div>
              {h.agentViews.map((agent) => (
                <button
                  className={`agent-card ${agent.id} ${agent.selected ? "selected" : ""}`}
                  key={agent.id}
                  onClick={() => h.setSelected(agent.id)}
                >
                  <div className="agent-symbol">
                    <Icon
                      name={
                        agent.id === "coding"
                          ? "code"
                          : agent.id === "research"
                            ? "search"
                            : "folder"
                      }
                      size={17}
                    />
                  </div>
                  <div>
                    <strong>
                      {agent.name}
                      <span>{agent.status ?? "Unassigned"}</span>
                    </strong>
                    <small>{agent.role}</small>
                    {agent.selected && <p>{agent.title}</p>}
                  </div>
                </button>
              ))}
              {selected && (
                <div className="agent-assignment">
                  <p>Assign a bounded task to {selected.name}.</p>
                  <button
                    className="secondary full"
                    disabled={
                      !h.text.trim() ||
                      h.connection !== "connected" ||
                      busy ||
                      demo
                    }
                    onClick={() => void h.send(h.text, selected.id)}
                  >
                    Assign current message <Icon name="arrow" size={13} />
                  </button>
                </div>
              )}
              <p className="panel-note">
                <Icon name="shield" size={11} />
                Every specialist stays within your approved scope.
              </p>
            </div>
          )}
          {id === "activity" && (
            <div className="activity-list">
              <div className="panel-kicker">
                <span>FACTS, AS THEY HAPPEN</span>
                <span
                  className={`live-badge ${h.connection === "connected" ? "on" : ""}`}
                >
                  <i />
                  {h.connection === "connected" ? "LIVE" : "LOCAL"}
                </span>
              </div>
              {h.activity
                .slice(-30)
                .reverse()
                .map((item, i) => (
                  <div className="activity-item" key={item.id}>
                    <div className={`event-node ${item.kind}`} />
                    <div>
                      <p>{item.text}</p>
                      <time>
                        {time(item.time)}
                        {i === 0 ? " · Latest event" : ""}
                      </time>
                    </div>
                  </div>
                ))}
              {!h.activity.length && (
                <div className="empty-state">
                  <Icon name="activity" size={28} />
                  <h3>A quiet moment.</h3>
                  <p>Real task and tool events will appear here.</p>
                </div>
              )}
            </div>
          )}
          {id === "approvals" && (
            <div className="approvals-list">
              {!h.approvals.length ? (
                <div className="empty-state">
                  <Icon name="shield" size={32} />
                  <h3>You’re in control.</h3>
                  <p>
                    No actions are waiting for approval. Changes and checks
                    appear here with a concrete preview.
                  </p>
                </div>
              ) : (
                h.approvals.map((a) => (
                  <article className="approval-card" key={a.id}>
                    <span className="pill">Awaiting your decision</span>
                    <h3>{a.summary}</h3>
                    <p>
                      {a.agentId} · One use · Expires{" "}
                      {new Date(a.expiresAt * 1000).toLocaleTimeString()}
                    </p>
                    <pre>{a.preview}</pre>
                    <div className="approval-buttons">
                      <button
                        className="secondary"
                        onClick={() =>
                          void command("runtime_command", {
                            request: { command: "deny", id: a.id },
                          }).catch(h.fail)
                        }
                      >
                        Deny
                      </button>
                      <button
                        className="primary"
                        disabled={Date.now() > a.expiresAt * 1000}
                        onClick={() =>
                          void command("runtime_command", {
                            request: { command: "approve", id: a.id },
                          }).catch(h.fail)
                        }
                      >
                        Approve exact action
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          )}
          {id === "artifacts" && (
            <div className="artifacts-list">
              {!h.artifacts.length ? (
                <div className="empty-state">
                  <Icon name="folder" size={32} />
                  <h3>Space for what’s next.</h3>
                  <p>
                    Applied file manifests and task results appear here with
                    their provenance.
                  </p>
                </div>
              ) : (
                h.artifacts.map((artifact, i) => (
                  <article className="artifact-card" key={i}>
                    <Icon name="folder" />
                    <strong>{String(artifact.path ?? "Task artifact")}</strong>
                    <span className="pill">
                      {String(artifact.operation ?? "result")}
                    </span>
                    <pre>{JSON.stringify(artifact, null, 2)}</pre>
                    <button
                      className="secondary"
                      disabled={
                        !native || !h.root || typeof artifact.path !== "string"
                      }
                      onClick={() =>
                        void command("reveal_artifact", {
                          path: artifact.path,
                        }).catch(h.fail)
                      }
                    >
                      Reveal in Finder
                    </button>
                  </article>
                ))
              )}
              {!!h.tasks.length && (
                <div className="task-summary">
                  {h.tasks.map((task) => (
                    <p key={task.taskId}>
                      {agents.find((agent) => agent.id === task.agentId)?.name}{" "}
                      <span>{task.status}</span>
                      <small>{task.title}</small>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {id === "settings" &&
            h.layout.settings.visible &&
            (demo ? (
              <div className="settings-content">
                <div className="notice">
                  Demo mode. Provider and permission controls are disabled. Open
                  the normal desktop view to configure services.
                </div>
              </div>
            ) : (
              <Settings
                preferences={h.preferences}
                setPreferences={h.setPreferences}
                connected={h.connection === "connected"}
                connect={() => void h.connect()}
                disconnect={h.disconnect}
                root={h.root}
                domains={h.domains}
                onError={h.setNotice}
                clear={() => setConfirmClear(true)}
                auditioning={h.playing || h.voicePreparing}
                audition={() =>
                  h.playing || h.voicePreparing
                    ? h.voice.current?.stopSpeech()
                    : void h.voice.current
                        ?.speak(
                          "Hello. I’m Iris. Ready when you are.",
                          h.preferences.voiceId,
                        )
                        .catch(h.fail)
                }
              />
            ))}
        </Window>
      ))}
      <div className="voice-bar">
        <button
          className={`voice-button ${h.capture !== "off" ? "capturing" : ""}`}
          disabled={
            h.connection !== "connected" || h.finalizing || busy || demo
          }
          onClick={() => void h.toggleCapture()}
          aria-label={
            h.capture === "off"
              ? "Start voice input"
              : h.capture === "requested"
                ? "Cancel microphone setup"
                : "Finish speech and send"
          }
        >
          <Icon name={h.capture === "ready" ? "stop" : "mic"} size={19} />
        </button>
        <span>
          {h.capture === "requested"
            ? "Preparing microphone…"
            : h.capture === "ready"
              ? "Listening · Pause to send"
              : h.finalizing
                ? "Finishing transcript…"
                : h.voicePreparing
                  ? "Preparing Iris’s voice…"
                  : "A thought away."}
          <small>
            {h.capture === "off"
              ? h.wake.enabled
                ? h.wake.status === "listening"
                  ? "Local mic on · Say “Hey Iris,” then wait for Listening."
                  : h.wake.status === "authorizing"
                    ? "Allow macOS microphone and speech permissions."
                    : "Wake listening paused while Iris is busy."
                : "Click the mic or say “Hey Iris” when enabled."
              : "Your speech is being sent to Deepgram."}
          </small>
        </span>
        <button
          className={`wake-button ${h.wake.enabled ? "enabled" : ""}`}
          disabled={demo || !native || (!h.wake.enabled && !h.canWake)}
          aria-pressed={h.wake.enabled}
          aria-label="Enable Hey Iris"
          onClick={() => void h.toggleWake()}
          title="Local wake detection. Command audio goes to Deepgram after activation."
        >
          {h.wake.enabled ? "Hey Iris · On" : "Hey Iris · Off"}
        </button>
        {(h.playing || h.voicePreparing) && (
          <button
            className="icon-button"
            title="Stop speaking; task continues"
            aria-label="Stop speaking"
            onClick={() => h.voice.current?.stopSpeech()}
          >
            <Icon name="stop" />
          </button>
        )}
      </div>
      <div className="bottom-bar">
        <span className="system-label">
          <i />
          LIVING GALAXY <b>/</b> {native ? "MAC DESKTOP" : "BROWSER PREVIEW"}
        </span>
        <div className="widget-dock" aria-label="Widget launcher">
          {(Object.keys(widgetNames) as WidgetId[]).map((id) => (
            <button
              key={id}
              className={h.layout[id].visible ? "visible" : ""}
              onClick={() => open(id)}
              aria-label={`Open ${widgetNames[id]}`}
              title={widgetNames[id]}
            >
              <Icon name={icons[id]} size={17} />
              {id === "approvals" && h.approvals.length > 0 && (
                <b>{h.approvals.length}</b>
              )}
            </button>
          ))}
          <span />
          <button
            title="Reset layout"
            aria-label="Reset widget layout"
            onClick={() => h.setLayout(defaultLayout())}
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
        <span className="render-stats">
          {stats.fps ? `${stats.fps} FPS` : "WARMING UP"} <b>·</b>{" "}
          {stats.quality.toUpperCase()} <b>·</b> {webgl ? "WEBGL 2" : "STATIC"}
        </span>
      </div>
      {h.error && (
        <aside className="error-toast" role="alert">
          <Icon name="shield" />
          <div>
            <strong>Needs your attention</strong>
            <p>{h.error}</p>
            <button
              className="text-button"
              onClick={() => {
                h.setError("");
                if (h.connection !== "connected") open("settings");
              }}
            >
              Dismiss{h.connection !== "connected" ? " & open settings" : ""}
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => h.setError("")}
          >
            <Icon name="close" size={14} />
          </button>
        </aside>
      )}
      {h.notice && (
        <aside className="notice-toast" role="status">
          <p>{h.notice}</p>
          <button
            className="icon-button"
            aria-label="Dismiss notice"
            onClick={() => h.setNotice("")}
          >
            <Icon name="close" size={14} />
          </button>
        </aside>
      )}
      {confirmClear && (
        <div className="modal-backdrop">
          <section
            className="confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <Icon name="shield" size={28} />
            <h3 id="clear-title">Clear Iris history?</h3>
            <p>
              Remove local conversations, task results, and activity. Provider
              keys and project files remain untouched.
            </p>
            <div className="approval-buttons">
              <button
                autoFocus
                className="secondary"
                onClick={() => setConfirmClear(false)}
              >
                Keep history
              </button>
              <button
                className="primary danger"
                onClick={() => {
                  void h.clear();
                  setConfirmClear(false);
                }}
              >
                Clear history
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
