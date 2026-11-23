import "server-only";
import { ApiFailure } from "./api";

const windows = new Map<string, number[]>();

/**
 * Limit prób w oknie czasu (w pamięci procesu). Chroni m.in. przed użyciem naszego serwera do zgadywania
 * haseł do cudzych skrzynek. Przy kilku instancjach serwera zastąpimy go wspólnym magazynem.
 */
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= max) {
    throw new ApiFailure(429, "RATE_LIMITED", "Za dużo prób, spróbuj ponownie później");
  }
  recent.push(now);
  windows.set(key, recent);
}
