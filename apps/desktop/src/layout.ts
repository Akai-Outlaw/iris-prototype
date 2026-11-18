export type WidgetId =
  | "conversation"
  | "activity"
  | "specialists"
  | "approvals"
  | "artifacts"
  | "settings";
export type WindowLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  z: number;
};
export type Layout = Record<WidgetId, WindowLayout>;
export const widgetNames: Record<WidgetId, string> = {
  conversation: "Conversation",
  activity: "Live activity",
  specialists: "Specialists",
  approvals: "Approvals",
  artifacts: "Tasks & artifacts",
  settings: "Settings",
};
export function clampWindow(
  w: WindowLayout,
  width: number,
  height: number,
): WindowLayout {
  const h = Math.max(180, Math.min(w.height, height - 140)),
    s = Math.max(270, Math.min(w.width, width - 32));
  return {
    ...w,
    width: s,
    height: h,
    x: Math.max(16, Math.min(w.x, width - s - 16)),
    y: Math.max(86, Math.min(w.y, height - h - 54)),
  };
}
export function defaultLayout(
  width = innerWidth,
  height = innerHeight,
): Layout {
  return {
    conversation: clampWindow(
      { x: 28, y: height - 433, width: 365, height: 370, visible: true, z: 2 },
      width,
      height,
    ),
    specialists: clampWindow(
      { x: width - 334, y: 155, width: 305, height: 300, visible: true, z: 3 },
      width,
      height,
    ),
    activity: clampWindow(
      {
        x: width - 334,
        y: height - 365,
        width: 305,
        height: 302,
        visible: true,
        z: 4,
      },
      width,
      height,
    ),
    approvals: clampWindow(
      {
        x: width / 2 - 230,
        y: 160,
        width: 460,
        height: 390,
        visible: false,
        z: 5,
      },
      width,
      height,
    ),
    artifacts: clampWindow(
      { x: 55, y: 130, width: 400, height: 420, visible: false, z: 6 },
      width,
      height,
    ),
    settings: clampWindow(
      {
        x: width / 2 - 270,
        y: 115,
        width: 540,
        height: Math.min(700, height - 190),
        visible: false,
        z: 7,
      },
      width,
      height,
    ),
  };
}
export function restoreLayout(value: unknown): Layout {
  const base = defaultLayout();
  if (!value || typeof value !== "object") return base;
  for (const id of Object.keys(base) as WidgetId[]) {
    const item = (value as Layout)[id];
    if (
      item &&
      [item.x, item.y, item.width, item.height, item.z].every(
        Number.isFinite,
      ) &&
      typeof item.visible === "boolean"
    )
      base[id] = clampWindow(item, innerWidth, innerHeight);
  }
  return base;
}
