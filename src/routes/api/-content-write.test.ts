/**
 * What an admin is allowed to publish, and what is written down about it.
 *
 * These four pages are public, cached at the edge and indexed. The save
 * endpoint took any JSON and merged it, so a password copied out of an order
 * chat and pasted into a guide — by habit, in the same motion as pasting the
 * step it belonged to — would have been published to everyone and left in the
 * cache after it was removed. Refusing the save is the only moment at which
 * that is still reversible.
 *
 * And nothing recorded who changed the store's copy. A content edit is an
 * admin action against customer-facing text; every other admin action here
 * writes an `audit_logs` row and this one did not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findForbiddenSecret } from "@/lib/telegram-admin-routing.server";
import { looksLikeInternalNote } from "@/lib/internalMetadata";

const route = readFileSync(resolve(process.cwd(), "src/routes/api/content.ts"), "utf8");

describe("the content save", () => {
  it("is still admin-only", () => {
    expect(route).toContain("await requireAdmin(request)");
  });

  it("inspects the text at every depth, not just the top level", () => {
    /*
      A guide's step's warning is four levels down. Teaching each guard the
      shape of every editable page is how one of them ends up not knowing
      about the page added next.
    */
    expect(route).toContain("function textOf");
    expect(route).toContain("const strings = textOf(patch)");
  });

  it("refuses a secret before anything is stored", () => {
    expect(route).toContain("findForbiddenSecret(entry.text)");
    expect(route).toContain("هذه الصفحات عامة");
    // Before `updateStore`, or the refusal comes after publication.
    expect(route.indexOf("findForbiddenSecret(entry.text)")).toBeLessThan(
      route.indexOf("await updateStore("),
    );
  });

  it("refuses the shop's own bookkeeping too", () => {
    expect(route).toContain("looksLikeInternalNote(entry.text)");
    expect(route.indexOf("looksLikeInternalNote(entry.text)")).toBeLessThan(
      route.indexOf("await updateStore("),
    );
  });

  it("says which field was refused, so the admin can find it", () => {
    expect(route).toContain("field: entry.path");
  });

  it("records who changed what", () => {
    expect(route).toContain('"content.update"');
    expect(route).toContain('"site_content"');
    expect(route).toContain("createAuditLog(");
  });

  it("records the shape rather than a second copy of every page", () => {
    expect(route).toContain("shapeOf(patch)");
    expect(route).toContain("entries: value.length");
  });

  it("never fails a save because the log could not be written", () => {
    /*
      The content is stored by the time this runs. Reporting an error for a
      change that happened is worse than an incomplete log.
    */
    const after = route.slice(route.indexOf("await updateStore("));
    expect(after).toContain("try {");
    expect(after).toContain("[content:audit_failed]");
  });
});

describe("the detectors it leans on", () => {
  it("catch what an admin would actually paste from an order chat", () => {
    for (const text of [
      "كلمة المرور: 1234",
      "the password: hunter2",
      "رمز التحقق 445566",
    ]) {
      expect(findForbiddenSecret(text), text).toBeTruthy();
    }
  });

  it("catch a cost note pasted into a guide", () => {
    expect(looksLikeInternalNote("Supplier cost remains unconfirmed")).toBe(true);
    expect(looksLikeInternalNote("سعر البيع: 7,000 د.ع")).toBe(true);
  });

  it("leave ordinary help copy alone", () => {
    for (const text of [
      "افتح Nintendo eShop من الشاشة الرئيسية",
      "اضغط Link لربط الحساب",
      "الرمز صالح لمدة ساعة من وقت إرساله",
      "لا تضغط Forgot your password",
    ]) {
      expect(findForbiddenSecret(text), text).toBeUndefined();
      expect(looksLikeInternalNote(text), text).toBe(false);
    }
  });
});
