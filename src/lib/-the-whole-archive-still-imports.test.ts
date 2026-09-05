/**
 * @vitest-environment node
 *
 * The seventy-six real templates, run through the importer.
 *
 * Synthetic fixtures agree with whoever wrote them. These are the files the
 * shop was actually built from — `import-sources/nintendo-2026-08`, tracked in
 * the repository — and they are the only evidence that reading a price out of
 * a file instead of computing one has not quietly changed what the archive
 * imports as.
 *
 * The property that matters is the one a synthetic test cannot establish: not
 * one tier, across every file and both pricing paths, is priced at or below
 * what the copy cost to acquire.
 */
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { applyGameImportToForm, buildBatchGameImport, createBlankProductForm } from "./gameImportForm";
import { parseGameImport } from "./gameImportParser";
import { readyTierPricing } from "./nintendoPricing";

const DIR = "import-sources/nintendo-2026-08";

const FILES = readdirSync(DIR)
  .filter((name) => name.endsWith(".txt"))
  .sort();

const read = (name: string) => readFileSync(`${DIR}/${name}`, "utf8");

const formOf = (raw: string) =>
  applyGameImportToForm(createBlankProductForm("cat_nintendo"), parseGameImport(raw).data);

describe("the archive the shop was built from", () => {
  it("is the seventy-six files this test claims to cover", () => {
    // A directory that quietly empties would make every assertion below vacuous.
    expect(FILES.length).toBe(76);
  });

  it("never prices a tier at or below what it cost", () => {
    /*
      Both paths at once: eight of these files state their own prices and the
      other sixty-eight are priced by the engine, and the guarantee has to hold
      across both or the file's numbers are not safe to read.
    */
    const offenders: string[] = [];
    for (const name of FILES) {
      const built = buildBatchGameImport(read(name), "cat_nintendo");
      if (!built.ok) continue;
      for (const type of built.payload["types"] as { id: string; price: number; cost: number }[]) {
        if (!(type.price > type.cost)) {
          offenders.push(`${name} ${type.id} ${type.price}/${type.cost}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still imports every file it imported before, and refuses none for a demand tier", () => {
    /*
      Sixty-eight import; the eight that do not are refused for their own
      reasons — a device-performance record the schema rejects, a supplier row
      with no usable amount, extras on one account only. None of them is about
      a demand tier, and none of them is new.
    */
    const refusals = FILES.map((name) => ({ name, built: buildBatchGameImport(read(name), "cat_nintendo") }))
      .filter((entry) => !entry.built.ok)
      .map((entry) => (entry.built.ok ? "" : entry.built.reason));

    expect(refusals).toHaveLength(8);
    for (const reason of refusals) expect(reason).not.toContain("فئة طلب");
  });

  it("reads its own prices from exactly the files that state them", () => {
    /*
      Nine of the seventy-six state prices this path will read — the corrected
      ones, whose offline rows carry a price and a cost that differ. The other
      sixty-seven are the legacy shape, one supplier number in both fields, and
      must go to the engine. If this count drifts, the rule that tells them
      apart has changed meaning.

      Eight of the nine also import; the ninth is refused further on for a
      device-performance record the schema will not take, which is a fault in
      that file and not in its prices.
    */
    const ready = FILES.filter((name) => {
      const form = formOf(read(name));
      return Boolean(readyTierPricing(Array.isArray(form.types) ? form.types : []));
    });
    expect(ready).toHaveLength(9);
    expect(ready.filter((name) => buildBatchGameImport(read(name), "cat_nintendo").ok)).toHaveLength(8);
  });

  it("would have passed the old demand-tier gate too, which is why nobody saw the fault", () => {
    /*
      Every one of these files carries a filled slug, and all seventy-six are
      in the table — it was maintained for this archive. So the gate never bit
      here, and the fault only showed on a file written from the shipped
      template, for a game nobody had catalogued yet.
    */
    const blank = FILES.filter((name) => !String(formOf(read(name)).slug ?? "").trim());
    expect(blank).toEqual([]);
  });
});
