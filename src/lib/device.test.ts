import { describe, expect, it } from "vitest";
import { deviceLabel, sessionIdOf } from "./device";

describe("device identity", () => {
  it("names common browsers and systems", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome · Android");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari · iPhone/iPad");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge · Windows");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox · Windows");
  });

  it("reads the session id from an access token", () => {
    const payload = btoa(JSON.stringify({ sub: "u", session_id: "abc-123" })).replace(/=+$/, "");
    expect(sessionIdOf(`h.${payload}.s`)).toBe("abc-123");
    expect(sessionIdOf("not-a-token")).toBe("not-a-token");
  });
});
