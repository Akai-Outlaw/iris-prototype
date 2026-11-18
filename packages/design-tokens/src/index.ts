import type { OrbState } from "@iris/contracts";
export const palette = {
  background: "#050915",
  blue: "#398dff",
  cyan: "#65e7ff",
  violet: "#a28cff",
  amber: "#a88d58",
  gold: "#f5ce79",
  red: "#ff687f",
  text: "#e4ecff",
  muted: "#92a0bc",
} as const;
export const stateTargets: Record<
  OrbState,
  {
    primary: string;
    secondary: string;
    speed: number;
    displacement: number;
    glow: number;
    label: string;
  }
> = {
  idle: {
    primary: palette.blue,
    secondary: palette.cyan,
    speed: 0.16,
    displacement: 0.055,
    glow: 0.36,
    label: "At your service",
  },
  arming: {
    primary: palette.amber,
    secondary: palette.gold,
    speed: 0.12,
    displacement: 0.045,
    glow: 0.35,
    label: "Preparing microphone",
  },
  listening: {
    primary: palette.gold,
    secondary: palette.amber,
    speed: 0.22,
    displacement: 0.12,
    glow: 0.5,
    label: "Listening",
  },
  processing: {
    primary: palette.blue,
    secondary: palette.violet,
    speed: 0.3,
    displacement: 0.095,
    glow: 0.5,
    label: "Working on it",
  },
  speaking: {
    primary: palette.cyan,
    secondary: palette.blue,
    speed: 0.24,
    displacement: 0.14,
    glow: 0.6,
    label: "Speaking",
  },
  error: {
    primary: palette.red,
    secondary: palette.red,
    speed: 0.04,
    displacement: 0.025,
    glow: 0.4,
    label: "Needs your attention",
  },
};
export function applyTokens() {
  for (const [key, value] of Object.entries(palette))
    document.documentElement.style.setProperty(`--${key}`, value);
}
