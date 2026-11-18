import { z } from "zod";
export const OrbStateSchema = z.enum([
  "idle",
  "arming",
  "listening",
  "processing",
  "speaking",
  "error",
]);
export type OrbState = z.infer<typeof OrbStateSchema>;
export const SpecialistIdSchema = z.enum(["coding", "research", "file-task"]);
export type SpecialistId = z.infer<typeof SpecialistIdSchema>;
export const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "waiting-approval",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const AgentSchema = z.object({
  id: SpecialistIdSchema,
  name: z.string(),
  role: z.string(),
  status: TaskStatusSchema.nullable(),
  title: z.string(),
  selected: z.boolean(),
});
export type AgentVisualState = z.infer<typeof AgentSchema>;
export const agents: readonly AgentVisualState[] = [
  {
    id: "coding",
    name: "Axiom",
    role: "Coding",
    status: null,
    title: "No task assigned",
    selected: false,
  },
  {
    id: "research",
    name: "Spectra",
    role: "Research",
    status: null,
    title: "No task assigned",
    selected: false,
  },
  {
    id: "file-task",
    name: "Umbra",
    role: "Files & Tasks",
    status: null,
    title: "No task assigned",
    selected: false,
  },
];
export type AudioFeatures = {
  source: "microphone" | "playback" | "demo";
  level: number;
  bass: number;
  treble: number;
  timestampMs: number;
  available: boolean;
};
export type Domains = {
  capture: "off" | "requested" | "ready";
  generation: boolean;
  playback: boolean;
  foregroundTask: boolean;
  blockingError: boolean;
};
export function deriveOrbState(d: Domains): OrbState {
  if (d.blockingError) return "error";
  if (d.capture === "requested") return "arming";
  if (d.capture === "ready") return "listening";
  if (d.playback) return "speaking";
  if (d.generation || d.foregroundTask) return "processing";
  return "idle";
}
export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
  incomplete: z.boolean().optional(),
});
export type Message = z.infer<typeof MessageSchema>;
export const ActivitySchema = z.object({
  id: z.string(),
  time: z.string(),
  kind: z.enum(["connection", "task", "tool", "approval", "error", "system"]),
  text: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;
export const RuntimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.delta"), text: z.string() }),
  z.object({ type: z.literal("message.final"), text: z.string() }),
  z.object({ type: z.literal("turn.started") }),
  z.object({ type: z.literal("turn.completed") }),
  z.object({ type: z.literal("turn.cancelled") }),
  z.object({
    type: z.literal("tool.started"),
    name: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("tool.completed"),
    name: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("tool.failed"),
    name: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("approval.requested"),
    id: z.string(),
    runId: z.string(),
    agentId: SpecialistIdSchema,
    tool: z.string(),
    digest: z.string(),
    preview: z.string(),
    expiresAt: z.number(),
    path: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("approval.resolved"),
    id: z.string(),
    status: z.enum(["consumed", "denied", "expired"]),
  }),
  z.object({
    type: z.literal("artifact.created"),
    artifact: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("scope.updated"),
    root: z.string(),
    domains: z.array(z.string()),
  }),
  z.object({
    type: z.literal("snapshot"),
    tasks: z.array(
      z.object({
        taskId: z.string(),
        agentId: SpecialistIdSchema,
        status: TaskStatusSchema,
        title: z.string(),
      }),
    ),
    approvals: z.array(z.unknown()),
    artifacts: z.array(z.record(z.string(), z.unknown())),
    busy: z.boolean(),
    root: z.string(),
    domains: z.array(z.string()),
    detail: z.string(),
  }),
  z.object({
    type: z.literal("task.updated"),
    taskId: z.string(),
    agentId: SpecialistIdSchema,
    status: TaskStatusSchema,
    title: z.string(),
  }),
  z.object({
    type: z.literal("connection"),
    status: z.enum(["connected", "disconnected", "reconnecting"]),
    detail: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    retryable: z.boolean(),
    scope: z.enum(["connection", "turn", "command"]).default("turn"),
  }),
]);
export const EnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string(),
  sessionId: z.string(),
  sequence: z.number().int().positive(),
  occurredAt: z.string(),
  runId: z.string(),
  event: RuntimeEventSchema,
});
export type Envelope = z.infer<typeof EnvelopeSchema>;
export class EventCursor {
  sequence = 0;
  sessionId = "";
  accept(e: Envelope): "accept" | "duplicate" | "gap" {
    if (this.sessionId && e.sessionId !== this.sessionId) return "gap";
    if (e.sequence <= this.sequence) return "duplicate";
    if (e.sequence !== this.sequence + 1) return "gap";
    this.sessionId = e.sessionId;
    this.sequence = e.sequence;
    return "accept";
  }
  reset(sessionId: string, sequence: number) {
    this.sessionId = sessionId;
    this.sequence = sequence;
  }
}
