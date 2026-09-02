/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useI18n } from "@/i18n";

describe("language synchronization", () => {
  beforeEach(() => {
    useI18n.setState({ lang: "ar" });
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
  });

  it("updates the document without reloading the page", () => {
    const originalUrl = window.location.href;

    useI18n.getState().setLang("en");

    expect(useI18n.getState().lang).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(window.location.href).toBe(originalUrl);
  });

  it("is idempotent when the profile language is already active", () => {
    const subscriber = vi.fn();
    const unsubscribe = useI18n.subscribe(subscriber);

    useI18n.getState().setLang("ar");

    expect(subscriber).not.toHaveBeenCalled();
    unsubscribe();
  });
});
