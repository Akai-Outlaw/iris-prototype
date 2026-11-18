import { useRef, type ReactNode, type PointerEvent } from "react";
import {
  clampWindow,
  widgetNames,
  type WidgetId,
  type WindowLayout,
} from "./layout";
import { Icon } from "./Icon";
const icons: Record<WidgetId, string> = {
  conversation: "chat",
  activity: "activity",
  specialists: "agents",
  approvals: "shield",
  artifacts: "folder",
  settings: "settings",
};
export function Window({
  id,
  layout,
  update,
  children,
  hidden,
}: {
  id: WidgetId;
  layout: WindowLayout;
  update: (id: WidgetId, change: Partial<WindowLayout>) => void;
  children: ReactNode;
  hidden?: boolean;
}) {
  const origin = useRef({ x: 0, y: 0, layout });
  const start = (event: PointerEvent, resize: boolean) => {
    if (
      event.button !== 0 ||
      (!resize &&
        (event.target as HTMLElement).closest("button,input,textarea,select,a"))
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY, layout };
    const element = event.currentTarget as HTMLElement;
    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - origin.current.x,
        dy = e.clientY - origin.current.y;
      const old = origin.current.layout;
      update(
        id,
        clampWindow(
          {
            ...old,
            ...(resize
              ? { width: old.width + dx, height: old.height + dy }
              : { x: old.x + dx, y: old.y + dy }),
          },
          innerWidth,
          innerHeight,
        ),
      );
    };
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  };
  return (
    <section
      className={`widget widget-${id}`}
      aria-label={widgetNames[id]}
      hidden={hidden || !layout.visible}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
        zIndex: layout.z,
      }}
      onPointerDown={() => update(id, { z: Date.now() % 1000000000 })}
    >
      <div className="widget-head" onPointerDown={(e) => start(e, false)}>
        <span>
          <Icon name={icons[id]} size={15} />
          {widgetNames[id]}
        </span>
        <div>
          <button
            className="icon-button"
            title="Move window: arrow keys; Shift + arrows to resize"
            aria-label={`Move or resize ${widgetNames[id]}`}
            onKeyDown={(e) => {
              const dx =
                  e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0,
                dy = e.key === "ArrowUp" ? -16 : e.key === "ArrowDown" ? 16 : 0;
              if (dx || dy) {
                e.preventDefault();
                update(
                  id,
                  clampWindow(
                    {
                      ...layout,
                      ...(e.shiftKey
                        ? {
                            width: layout.width + dx,
                            height: layout.height + dy,
                          }
                        : { x: layout.x + dx, y: layout.y + dy }),
                    },
                    innerWidth,
                    innerHeight,
                  ),
                );
              }
            }}
          >
            <Icon name="move" size={13} />
          </button>
          <button
            className="icon-button"
            aria-label={`Close ${widgetNames[id]}`}
            onClick={() => update(id, { visible: false })}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
      <div className="widget-body">{children}</div>
      <button
        className="resize-handle"
        aria-label={`Resize ${widgetNames[id]}; use move control with Shift and arrows for keyboard resizing`}
        onPointerDown={(e) => start(e, true)}
      >
        <Icon name="resize" size={13} />
      </button>
    </section>
  );
}
