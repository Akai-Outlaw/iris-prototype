import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export const native = isTauri();
export async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    throw new Error(
      "Open the Iris desktop app to use secure settings and assistant connections.",
    );
  return invoke<T>(name, args);
}
export async function subscribe<T>(
  name: string,
  callback: (payload: T) => void,
) {
  if (!native) return () => {};
  return listen<T>(name, (event) => callback(event.payload));
}
export const safeError = (error: unknown) =>
  typeof error === "string" && error.length < 400
    ? error
    : error instanceof Error
      ? error.message.slice(0, 400)
      : "The operation could not complete. Please try again.";
