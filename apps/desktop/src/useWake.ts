import { useEffect, useRef, useState } from "react";
import { command, native, subscribe } from "./bridge";
type Status = "off" | "authorizing" | "listening" | "paused" | "detected";
export function useWake(
  canListen: boolean,
  onWake: () => Promise<void>,
  fail: (error: unknown) => void,
) {
  const [enabled, setEnabled] = useState(false),
    [status, setStatus] = useState<Status>("off");
  const active = useRef(""),
    latest = useRef({ canListen, onWake, fail });
  latest.current = { canListen, onWake, fail };
  const control = (action: string, id = active.current) =>
    id
      ? command("wake_control", { activationId: id, action })
      : Promise.resolve();
  const disable = () => {
    const id = active.current;
    active.current = "";
    setEnabled(false);
    setStatus("off");
    void control("stop", id).catch(fail);
  };
  useEffect(() => {
    let disposed = false,
      off: undefined | (() => void);
    void subscribe<{ activationId: string; status: string; message: string }>(
      "iris:wake",
      (event) => {
        if (disposed || event.activationId !== active.current) return;
        if (event.status === "error") {
          disable();
          latest.current.fail(new Error(event.message));
          return;
        }
        if (event.status === "detected") {
          setStatus("detected");
          if (latest.current.canListen)
            void latest.current.onWake().catch((error) => {
              disable();
              latest.current.fail(error);
            });
        } else if (
          ["off", "authorizing", "listening", "paused"].includes(event.status)
        )
          setStatus(event.status as Status);
      },
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch(fail);
    return () => {
      disposed = true;
      off?.();
      const id = active.current;
      active.current = "";
      void control("stop", id).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (enabled) void control(canListen ? "resume" : "pause").catch(fail);
  }, [canListen]);
  const toggle = async () => {
    if (enabled) {
      disable();
      return;
    }
    if (!native || !latest.current.canListen) return;
    const id = crypto.randomUUID();
    active.current = id;
    setEnabled(true);
    setStatus("authorizing");
    try {
      await command("wake_start", { activationId: id });
    } catch (error) {
      disable();
      fail(error);
    }
  };
  return { enabled, status, toggle, disable, pause: () => control("pause") };
}
