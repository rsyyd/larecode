import { describe, expect, it } from "vitest";
import { Permissions } from "./permission.js";

describe("Permissions", () => {
  it("allows allowed groups in ask mode", () => {
    const permissions = new Permissions({ mode: "ask", allowedGroups: ["read"] });
    expect(permissions.check("read").allowed).toBe(true);
  });

  it("denies groups outside the allowed list in ask mode", () => {
    const permissions = new Permissions({ mode: "ask", allowedGroups: ["read"] });
    expect(permissions.check("write").allowed).toBe(false);
  });

  it("allows everything in allow mode", () => {
    const permissions = new Permissions({ mode: "allow", allowedGroups: [] });
    expect(permissions.check("shell").allowed).toBe(true);
  });

  it("denies everything in deny mode", () => {
    const permissions = new Permissions({ mode: "deny", allowedGroups: ["read"] });
    expect(permissions.check("read").allowed).toBe(false);
  });

  it("default-denies unattended flows without a pre-authorized bundle", () => {
    const permissions = new Permissions({ mode: "ask", allowedGroups: ["read"] });
    const decision = permissions.check("shell", { unattended: true });
    expect(decision.allowed).toBe(false);
  });

  it("allows pre-authorized groups in unattended flows", () => {
    const permissions = new Permissions({
      mode: "ask",
      allowedGroups: ["read"],
      preAuthorized: { cron: ["read", "shell"] },
    });
    expect(permissions.check("shell", { unattended: true }).allowed).toBe(true);
  });

  it("never pre-authorizes destructive or secrets in unattended flows", () => {
    const permissions = new Permissions({
      mode: "ask",
      allowedGroups: ["read"],
      preAuthorized: { cron: ["destructive", "secrets", "read"] },
    });
    expect(permissions.check("destructive", { unattended: true }).allowed).toBe(false);
    expect(permissions.check("secrets", { unattended: true }).allowed).toBe(false);
  });
});