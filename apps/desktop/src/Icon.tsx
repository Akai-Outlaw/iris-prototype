const shapes: Record<string, string> = {
  chat: "M4 4h16v12H9l-5 4V4Z M8 8h8 M8 12h5",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  agents:
    "M12 4v5 M5 17l4-4 M19 17l-4-4 M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M2 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M18 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z M8 12l3 3 5-6",
  folder: "M3 6h7l2 3h9v11H3V6Z",
  settings:
    "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2",
  expand: "M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6",
  close: "M6 6l12 12 M18 6L6 18",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5 M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  code: "M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  search: "M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M15 15l6 6",
  plus: "M12 4v16 M4 12h16",
  check: "M4 12l5 5L20 6",
  refresh: "M20 10a8 8 0 1 0-1 8 M20 3v7h-7",
  stop: "M6 6h12v12H6V6Z",
  volume: "M3 9h4l5-5v16l-5-5H3V9 M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  grid: "M3 3h7v7H3V3 M14 3h7v7h-7V3 M3 14h7v7H3v-7 M14 14h7v7h-7v-7",
  move: "M12 2v20 M2 12h20 M8 6l4-4 4 4 M18 8l4 4-4 4 M16 18l-4 4-4-4 M6 16l-4-4 4-4",
  resize: "M8 20L20 8 M14 20l6-6 M3 21L21 3",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={shapes[name] ?? shapes.plus} />
    </svg>
  );
}
