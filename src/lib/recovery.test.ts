/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recovery screen is the only thing standing between a member and a blank
 * page when a build goes stale, so it has to work with React already gone.
 */
describe("blank-screen recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    window.sessionStorage.clear();
  });

  it("shows a reload button instead of leaving the page blank when a reload just happened", async () => {
    const { handleModuleReload } = await import("./polyfills");
    window.sessionStorage.setItem("bananto_chunk_reload_at", String(Date.now()));
    window.sessionStorage.setItem("vitest_force_production", "1");

    handleModuleReload();

    const overlay = document.getElementById("bananto-recovery-screen");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("إعادة التحميل");
  });

  it("never stacks more than one recovery screen", async () => {
    const { showRecoveryScreen } = await import("./polyfills");
    showRecoveryScreen();
    showRecoveryScreen();
    expect(document.querySelectorAll("#bananto-recovery-screen")).toHaveLength(1);
  });

  it("ignores a third-party script that failed on its own", async () => {
    const { installPolyfills } = await import("./polyfills");
    installPolyfills();

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js?63";
    document.body.appendChild(script);
    script.dispatchEvent(new Event("error", { bubbles: false }));

    // No reload was scheduled, so nothing was recorded and nothing was shown.
    expect(window.sessionStorage.getItem("bananto_chunk_reload_at")).toBeNull();
    expect(document.getElementById("bananto-recovery-screen")).toBeNull();
  });

  it("gives up after repeated reloads instead of looping forever", async () => {
    const { handleModuleReload } = await import("./polyfills");
    window.sessionStorage.setItem("bananto_chunk_reload_count", "2");
    window.sessionStorage.setItem("vitest_force_production", "1");

    handleModuleReload();

    expect(document.getElementById("bananto-recovery-screen")).not.toBeNull();
  });

  it("survives sessionStorage throwing, as it does in private mode", async () => {
    const { handleModuleReload } = await import("./polyfills");
    const getItem = vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setItem = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => handleModuleReload()).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
