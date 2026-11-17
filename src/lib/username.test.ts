import { describe, expect, it } from "vitest";
import { loginEmail, normalizeUsername, USERNAME_RE, usernameOf } from "./username";

describe("usernames", () => {
  it("maps a username to its internal address and keeps real emails", () => {
    expect(loginEmail("  Samer_99 ")).toBe("samer_99@users.rozeflow.com");
    expect(loginEmail("ward@example.com")).toBe("ward@example.com");
  });
  it("reads the username back and ignores real emails", () => {
    expect(usernameOf("samer_99@users.rozeflow.com")).toBe("samer_99");
    expect(usernameOf("ward@example.com")).toBeNull();
  });
  it("accepts 3 to 20 latin letters, digits and underscores", () => {
    expect(USERNAME_RE.test(normalizeUsername("Ab_1"))).toBe(true);
    expect(USERNAME_RE.test("ab")).toBe(false);
    expect(USERNAME_RE.test("سامر")).toBe(false);
    expect(USERNAME_RE.test("a".repeat(21))).toBe(false);
    expect(USERNAME_RE.test("a.b")).toBe(false);
  });
});
