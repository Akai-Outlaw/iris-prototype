import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  agents,
  deriveOrbState,
  EnvelopeSchema,
  RuntimeEventSchema,
  EventCursor,
  MessageSchema,
  ActivitySchema,
  type AudioFeatures,
  type Activity,
  type Message,
  type SpecialistId,
  type TaskStatus,
} from "@iris/contracts";
import { Voice } from "./audio";
import { useWake } from "./useWake";
import { command, native, safeError, subscribe } from "./bridge";
import { defaultPreferences } from "./Settings";
import {
  clampWindow,
  defaultLayout,
  restoreLayout,
  type Layout,
  type WidgetId,
  type WindowLayout,
} from "./layout";
export type Task = {
  taskId: string;
  agentId: SpecialistId;
  status: TaskStatus;
  title: string;
};
export type Approval = Extract<
  z.infer<typeof RuntimeEventSchema>,
  { type: "approval.requested" }
>;
const Tasks = z.array(
  z.object({
    taskId: z.string(),
    agentId: z.enum(["coding", "research", "file-task"]),
    status: z.enum([
      "queued",
      "running",
      "waiting-approval",
      "completed",
      "failed",
      "cancelled",
    ]),
    title: z.string(),
  }),
);
const Prefs = z.object({
  provider: z.enum(["chatgpt", "hermes"]).default("chatgpt"),
  names: z
    .object({
      coding: z.string().max(24),
      research: z.string().max(24),
      "file-task": z.string().max(24),
    })
    .default(defaultPreferences.names),
  voiceId: z.string().max(100),
  autoSpeak: z.boolean(),
  quality: z.enum(["auto", "high", "low"]),
  motion: z.enum(["system", "reduced", "full"]),
  retain: z.boolean(),
});
export function useIris(features: (features: AudioFeatures) => void) {
  const [layout, setLayout] = useState<Layout>(() => defaultLayout()),
    [preferences, setPreferences] = useState(defaultPreferences),
    [loaded, setLoaded] = useState(false),
    [connection, setConnection] = useState<
      "connected" | "connecting" | "disconnected"
    >("disconnected"),
    [detail, setDetail] = useState("Connect your existing Hermes assistant"),
    [text, setText] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [activity, setActivity] = useState<Activity[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [approvals, setApprovals] = useState<Approval[]>([]),
    [artifacts, setArtifacts] = useState<Record<string, unknown>[]>([]),
    [selected, setSelected] = useState<SpecialistId | null>(null),
    [root, setRoot] = useState(""),
    [domains, setDomains] = useState<string[]>([]),
    [capture, setCapture] = useState<"off" | "requested" | "ready">("off"),
    [generating, setGenerating] = useState(false),
    [playing, setPlaying] = useState(false),
    [voicePreparing, setVoicePreparing] = useState(false),
    [finalizing, setFinalizing] = useState(false),
    [transcript, setTranscript] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const finishVoice = useRef<() => Promise<void>>(async () => {});
  const finishing = useRef(false);
  const spokenTurn = useRef("");
  const voice = useRef<Voice | null>(null),
    cursor = useRef(new EventCursor()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    lastRun = useRef(""),
    admitting = useRef(false),
    latest = useRef({ preferences, connection, approvals });
  latest.current = { preferences, connection, approvals };
  const log = useCallback(
    (kind: Activity["kind"], text: string) =>
      setActivity((items) =>
        [
          ...items,
          {
            id: crypto.randomUUID(),
            kind,
            text,
            time: new Date().toISOString(),
          },
        ].slice(-300),
      ),
    [],
  );
  const fail = useCallback(
    (value: unknown) => {
      const message = safeError(value);
      setError(message);
      log("error", message);
    },
    [log],
  );
  const updateWindow = useCallback(
    (id: WidgetId, change: Partial<WindowLayout>) =>
      setLayout((old) => ({
        ...old,
        [id]: {
          ...old[id],
          ...change,
          ...(change.z === undefined
            ? {}
            : {
                z:
                  Math.max(...Object.values(old).map((window) => window.z)) + 1,
              }),
        },
      })),
    [],
  );
  const open = useCallback(
    (id: WidgetId) =>
      updateWindow(id, { visible: true, z: Date.now() % 1000000000 }),
    [updateWindow],
  );
  const agentViews = agents.map((agent) => {
    const task = tasks.find((task) => task.agentId === agent.id);
    return {
      ...agent,
      name: preferences.names[agent.id] || agent.name,
      status: task?.status ?? null,
      title: task?.title ?? "No task assigned",
      selected: agent.id === selected,
    };
  });
  const state = deriveOrbState({
    capture,
    generation:
      generating &&
      (!approvals.length || tasks.some((task) => task.status === "running")),
    playback: playing,
    foregroundTask: false,
    blockingError: !!error,
  });
  useEffect(() => {
    const resize = () =>
      setLayout(
        (old) =>
          Object.fromEntries(
            Object.entries(old).map(([id, value]) => [
              id,
              clampWindow(value, innerWidth, innerHeight),
            ]),
          ) as Layout,
      );
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = native
          ? await command<unknown>("load_workspace")
          : JSON.parse(localStorage.getItem("omni-preview-layout") ?? "null");
        if (!alive) return;
        if (saved && typeof saved === "object") {
          const value = saved as Record<string, unknown>;
          setLayout(restoreLayout(value.layout));
          const pref = Prefs.safeParse(value.preferences);
          if (pref.success) setPreferences(pref.data);
          if (pref.success && pref.data.retain) {
            const chat = z.array(MessageSchema).safeParse(value.messages),
              events = z.array(ActivitySchema).safeParse(value.activity);
            if (chat.success) setMessages(chat.data);
            if (events.success) setActivity(events.data);
          }
          const recovered = Tasks.safeParse(value.tasks);
          if (recovered.success)
            setTasks(
              recovered.data.map((task) =>
                ["queued", "running", "waiting-approval"].includes(task.status)
                  ? { ...task, status: "cancelled" }
                  : task,
              ),
            );
        }
      } catch (e) {
        if (alive) fail(e);
      } finally {
        if (alive) {
          setLoaded(true);
          log(
            "system",
            native
              ? "Iris desktop opened. No folder access granted."
              : "Browser preview opened. Native services unavailable.",
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const save = setTimeout(() => {
      const workspace = {
        version: 1,
        layout,
        preferences,
        messages: preferences.retain ? messages.slice(-300) : [],
        activity: preferences.retain ? activity.slice(-300) : [],
        tasks: tasks.slice(-100),
      };
      if (native) void command("save_workspace", { workspace }).catch(fail);
      else
        try {
          localStorage.setItem(
            "omni-preview-layout",
            JSON.stringify({
              layout,
              preferences: { ...preferences, voiceId: "" },
            }),
          );
        } catch {}
    }, 500);
    return () => clearTimeout(save);
  }, [loaded, layout, preferences, messages, activity, tasks]);
  useEffect(() => {
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const add = async <T>(name: string, callback: (value: T) => void) => {
      const unlisten = await subscribe<T>(name, callback);
      if (disposed) unlisten();
      else cleanup.push(unlisten);
    };
    void add<unknown>("iris:runtime", (raw) => {
      const parsed = EnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        fail(new Error("Unsupported runtime event. Reconnect Hermes."));
        return;
      }
      const envelope = parsed.data,
        event = envelope.event;
      if (
        event.type === "connection" &&
        event.status === "connected" &&
        cursor.current.sessionId !== envelope.sessionId
      )
        cursor.current.reset(envelope.sessionId, 0);
      if (event.type === "snapshot") {
        cursor.current.reset(envelope.sessionId, envelope.sequence);
        clearTimeout(timer.current);
        setConnection("connected");
        setDetail(event.detail);
        setRoot(event.root);
        setDomains(event.domains);
        setTasks(event.tasks);
        setArtifacts(event.artifacts);
        setGenerating(event.busy);
        const pending = z.array(RuntimeEventSchema).safeParse(event.approvals);
        if (pending.success)
          setApprovals(
            pending.data.filter(
              (item): item is Approval => item.type === "approval.requested",
            ),
          );
        return;
      }
      const result = cursor.current.accept(envelope);
      if (result === "duplicate") return;
      if (result === "gap") {
        setDetail("Resynchronizing runtime state");
        void command("runtime_command", {
          request: { command: "snapshot" },
        }).catch(fail);
        return;
      }
      if (event.type === "connection") {
        clearTimeout(timer.current);
        setConnection(
          event.status === "connected" ? "connected" : "disconnected",
        );
        setDetail(event.detail);
        log("connection", event.detail);
      } else if (event.type === "turn.started") {
        lastRun.current = envelope.runId;
        setError("");
        setGenerating(true);
        admitting.current = false;
        setSubmitting(false);
        log("task", "Hermes accepted the turn.");
      } else if (
        event.type === "message.delta" ||
        event.type === "message.final"
      ) {
        if (envelope.runId !== lastRun.current) return;
        const final = event.type === "message.final";
        setMessages((old) => {
          const id = `assistant-${envelope.runId}`,
            existing = old.find((m) => m.id === id),
            message: Message = {
              id,
              role: "assistant",
              createdAt: existing?.createdAt ?? envelope.occurredAt,
              text: final ? event.text : (existing?.text ?? "") + event.text,
              incomplete: !final,
            };
          return existing
            ? old.map((item) => (item.id === id ? message : item))
            : [...old, message];
        });
        if (
          final &&
          (latest.current.preferences.autoSpeak ||
            spokenTurn.current === envelope.runId) &&
          latest.current.preferences.voiceId
        )
          void voice.current
            ?.speak(event.text, latest.current.preferences.voiceId)
            .catch(fail);
      } else if (
        event.type === "turn.completed" ||
        event.type === "turn.cancelled"
      ) {
        if (spokenTurn.current === envelope.runId) spokenTurn.current = "";
        setGenerating(false);
        log(
          "task",
          event.type === "turn.completed"
            ? "Assistant turn completed."
            : "Assistant turn cancelled.",
        );
      } else if (event.type === "task.updated") {
        setTasks((old) => [
          ...old.filter((task) => task.agentId !== event.agentId),
          event,
        ]);
        log(
          "task",
          `${agents.find((agent) => agent.id === event.agentId)?.name}: ${event.status}`,
        );
      } else if (event.type === "approval.requested") {
        setApprovals((old) => [
          ...old.filter((item) => item.id !== event.id),
          event,
        ]);
        setTasks((old) =>
          old.map((task) =>
            task.agentId === event.agentId
              ? { ...task, status: "waiting-approval" }
              : task,
          ),
        );
        log("approval", event.summary);
      } else if (event.type === "approval.resolved") {
        const request = latest.current.approvals.find(
          (item) => item.id === event.id,
        );
        if (request)
          setTasks((old) =>
            old.map((task) =>
              task.agentId === request.agentId &&
              task.status === "waiting-approval"
                ? { ...task, status: "running" }
                : task,
            ),
          );
        setApprovals((old) => old.filter((item) => item.id !== event.id));
        log("approval", `Action ${event.status}.`);
      } else if (event.type === "scope.updated") {
        setRoot(event.root);
        setDomains(event.domains);
        log(
          "system",
          event.root
            ? "Selected project access updated."
            : "Project access revoked.",
        );
      } else if (event.type === "artifact.created") {
        setArtifacts((old) => [...old, event.artifact]);
        log("tool", "Applied file manifest received.");
      } else if (
        event.type === "tool.started" ||
        event.type === "tool.completed" ||
        event.type === "tool.failed"
      )
        log("tool", `${event.name} · ${event.summary}`);
      else if (event.type === "error") {
        if (event.scope === "command") {
          setNotice(event.message);
          log("error", event.message);
          return;
        }
        setGenerating(false);
        admitting.current = false;
        setSubmitting(false);
        setMessages((old) =>
          old.map((message) =>
            message.id === `assistant-${envelope.runId}` && message.incomplete
              ? {
                  ...message,
                  incomplete: false,
                  text: message.text + "\n\n[Response interrupted.]",
                }
              : message,
          ),
        );
        if (latest.current.connection !== "connected") {
          setConnection("disconnected");
          clearTimeout(timer.current);
        }
        fail(event.message);
      }
    });
    void add<{ message: string }>("iris:disconnected", (event) => {
      clearTimeout(timer.current);
      setConnection("disconnected");
      voice.current?.cancelCapture();
      voice.current?.stopSpeech();
      setGenerating(false);
      setSubmitting(false);
      admitting.current = false;
      setApprovals([]);
      setRoot("");
      setDomains([]);
      setDetail(event.message);
      setTasks((old) =>
        old.map((task) =>
          ["running", "queued", "waiting-approval"].includes(task.status)
            ? { ...task, status: "cancelled" }
            : task,
        ),
      );
      log("connection", event.message);
    });
    const audio = new Voice(
      features,
      (status) => {
        setVoicePreparing(status === "preparing-speech");
        if (status === "arming") setCapture("requested");
        else if (status === "listening") setCapture("ready");
        else if (status === "preparing-speech") setPlaying(false);
        else if (status === "speaking") setPlaying(true);
        else {
          setCapture("off");
          setPlaying(false);
        }
      },
      setTranscript,
      fail,
      () => void finishVoice.current(),
    );
    voice.current = audio;
    void audio.initialize().catch(fail);
    return () => {
      disposed = true;
      cleanup.forEach((fn) => fn());
      void audio.dispose();
      clearTimeout(timer.current);
    };
  }, []);
  const connect = async () => {
    setError("");
    setConnection("connecting");
    setDetail("Validating scoped Hermes tools…");
    cursor.current.reset("", 0);
    try {
      await command("runtime_connect", { provider: preferences.provider });
      timer.current = setTimeout(() => {
        setConnection("disconnected");
        fail(
          new Error(
            "Hermes did not become ready. Reconnect after checking the local runtime.",
          ),
        );
      }, 30000);
    } catch (e) {
      setConnection("disconnected");
      fail(e);
    }
  };
  const disconnect = () => {
    wake.disable();
    voice.current?.cancelCapture();
    voice.current?.stopSpeech();
    void command("runtime_disconnect").catch(fail);
    setConnection("disconnected");
    setGenerating(false);
    setRoot("");
    setDomains([]);
    setApprovals([]);
  };
  const send = async (value = text, role?: SpecialistId, spoken = false) => {
    const content = value.trim();
    if (
      !content ||
      connection !== "connected" ||
      generating ||
      admitting.current
    )
      return;
    admitting.current = true;
    setSubmitting(true);
    setError("");
    voice.current?.stopSpeech();
    try {
      await voice.current?.activate();
    } catch {}
    const requestId = crypto.randomUUID();
    spokenTurn.current = spoken ? requestId : "";
    try {
      await command("runtime_command", {
        request: {
          command: role ? "delegate" : "send",
          requestId,
          text: content,
          ...(role ? { specialist: role } : {}),
        },
      });
      setMessages((old) => [
        ...old,
        {
          id: requestId,
          role: "user",
          text: content,
          createdAt: new Date().toISOString(),
        },
      ]);
      setText("");
      setTranscript("");
      open("conversation");
    } catch (e) {
      admitting.current = false;
      setSubmitting(false);
      fail(e);
    }
  };
  const finishCapture = async () => {
    if (finishing.current) return;
    finishing.current = true;
    setFinalizing(true);
    try {
      const final = await voice.current?.finishCapture();
      if (final?.trim()) await send(final, undefined, true);
      else setNotice("No speech detected. Try again or type a message.");
    } catch (error) {
      fail(error);
    } finally {
      finishing.current = false;
      setFinalizing(false);
    }
  };
  finishVoice.current = finishCapture;
  const canWake =
    connection === "connected" &&
    !generating &&
    !submitting &&
    !playing &&
    !voicePreparing &&
    capture === "off" &&
    !finalizing &&
    !error &&
    !approvals.length;
  const wake = useWake(
    canWake,
    async () => {
      await voice.current?.activate();
      setTranscript("");
      await voice.current?.startCapture();
    },
    fail,
  );
  const toggleWake = async () => {
    try {
      if (!wake.enabled) await voice.current?.activate();
      await wake.toggle();
    } catch (error) {
      fail(error);
    }
  };
  const toggleCapture = async () => {
    setError("");
    try {
      if (capture === "off" && !finishing.current) {
        await wake.pause();
        setTranscript("");
        await voice.current?.startCapture();
      } else if (capture === "requested") voice.current?.cancelCapture();
      else if (capture === "ready") await finishCapture();
    } catch (e) {
      fail(e);
    }
  };
  const clear = async () => {
    try {
      if (native) await command("clear_history");
      setMessages([]);
      setActivity([]);
      setTasks([]);
      setArtifacts([]);
      log(
        "system",
        "Local Iris history cleared. Project files were not changed.",
      );
    } catch (e) {
      fail(e);
    }
  };
  return {
    layout,
    setLayout,
    updateWindow,
    open,
    preferences,
    setPreferences,
    connection,
    detail,
    text,
    setText,
    messages,
    activity,
    tasks,
    approvals,
    artifacts,
    selected,
    setSelected,
    root,
    domains,
    capture,
    generating,
    playing,
    voicePreparing,
    finalizing,
    wake,
    toggleWake,
    canWake,
    transcript,
    setTranscript,
    error,
    setError,
    notice,
    setNotice,
    submitting,
    agentViews,
    state,
    connect,
    disconnect,
    send,
    toggleCapture,
    clear,
    voice,
    fail,
  };
}
