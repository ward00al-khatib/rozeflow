"use client";
/**
 * Device identity (spec appendix ط). A web page cannot read a MAC address, so each browser keeps a random
 * key in localStorage and registers it once per sign-in session. The server stores only its hash and binds
 * the session to it; game calls from a session whose device the owner has not approved are refused.
 */
import { supabase } from "./supabase/client";

export type DeviceStatus = "approved" | "pending" | "blocked" | "removed" | "unknown";

const STORAGE_KEY = "rozeflow-device-key";

function randomKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** This browser's device key, created on first use. */
export function deviceKey(): string {
  try {
    const found = localStorage.getItem(STORAGE_KEY);
    if (found && /^[A-Za-z0-9_-]{16,100}$/.test(found)) return found;
    const key = randomKey();
    localStorage.setItem(STORAGE_KEY, key);
    return key;
  } catch {
    // Storage blocked (private mode): a key for this page load only; the owner sees a new device.
    return randomKey();
  }
}

/** A short readable name for the owner's device list, e.g. "Chrome · Android". */
export function deviceLabel(ua: string): string {
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone/iPad"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "Mac"
          : /Linux/i.test(ua)
            ? "Linux"
            : "جهاز آخر";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung"
        : /Firefox|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome|CriOS/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "متصفح";
  return `${browser} · ${os}`;
}

const pending = new Map<string, Promise<DeviceStatus>>();

/** The session id inside a Supabase access token; stays the same across token refreshes. */
export function sessionIdOf(accessToken: string): string {
  try {
    const part = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part)) as { session_id?: string };
    return claims.session_id ?? accessToken;
  } catch {
    return accessToken;
  }
}

/** Registers this browser for the signed-in session (once per session per page load). */
export function registerDevice(accessToken: string): Promise<DeviceStatus> {
  const sessionKey = sessionIdOf(accessToken);
  let p = pending.get(sessionKey);
  if (!p) {
    p = (async () => {
      const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
      const { data, error } = await supabase().rpc("register_device", {
        p_device_key: deviceKey(),
        p_label: deviceLabel(ua),
        p_user_agent: ua.slice(0, 300),
      });
      if (error) {
        pending.delete(sessionKey);
        return "unknown" as DeviceStatus;
      }
      return ((data as { status?: string })?.status ?? "unknown") as DeviceStatus;
    })();
    pending.set(sessionKey, p);
  }
  return p;
}
