/**
 * @vitest-environment node
 *
 * A ZIP entry written from the shipped template, imported.
 *
 * The archive path refused every new game with "لا توجد فئة طلب موثقة للعبة",
 * and the reason is narrower and worse than "the game is missing from the
 * table": `buildBatchGameImport` looked the tier up by `form.slug`, and the
 * template ships `slug=` blank on purpose — the schema calls it optional and
 * says it is generated automatically, and the endpoint is what generates it,
 * downstream of this function. So the lookup key was the empty string on every
 * file an operator actually writes, and the refusal fired whether or not the
 * game was in the table.
 *
 * The suite did not catch it because its fixture hardcodes
 * `slug=super-smash-bros-ultimate` — a real entry in the table — on every game
 * it imports, Zelda and Metroid included.
 */
import { describe, expect, it } from "vitest";

import { buildBatchGameImport } from "./gameImportForm";
import { demandTierFor } from "./nintendoDemandTiers";

/**
 * The template as it ships: no slug, and a price and cost on every type row.
 *
 * `slug=` is blank because that is what the file in `public/templates` has,
 * and what an operator filling it in leaves behind.
 */
const template = (
  name: string,
  rows = `
type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=25000
type.1.cost=18000
type.1.is_infinite_stock=true

type.2.id=standard_online
type.2.name=النسخة القياسية
type.2.option_id=online_account
type.2.price=32000
type.2.cost=24000
type.2.is_infinite_stock=true
`,
) => `
schema_version=1
name=${name}
slug=
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
price=25000
cost=18000
is_infinite_stock=true

option.1.id=offline_account
option.1.name=حساب أوفلاين
option.1.is_infinite_stock=true

option.2.id=online_account
option.2.name=حساب أونلاين
option.2.is_infinite_stock=true
${rows}`;

const typesOf = (payload: Record<string, any>) =>
  Object.fromEntries(
    (payload["types"] as any[]).map((type) => [type.id, { price: type.price, cost: type.cost }]),
  );

describe("a game the demand-tier table has never heard of", () => {
  it("imports, instead of being refused for having no documented tier", () => {
    const built = buildBatchGameImport(template("Totally New Game"), "cat_nintendo");
    expect(built.ok).toBe(true);
  });

  it("is still refused nothing when its slug is filled in and unknown", () => {
    // Belt and braces: an operator who does fill the slug in, with a title the
    // table has never carried, must not be refused either.
    const built = buildBatchGameImport(
      template("Totally New Game").replace("slug=\n", "slug=totally-new-game\n"),
      "cat_nintendo",
    );
    expect(demandTierFor("totally-new-game").defaulted).toBe(true);
    expect(built.ok).toBe(true);
  });

  it("takes the price and the cost the file states, verbatim", () => {
    /*
      The whole point of writing them in the file. Before this the engine
      recomputed both from the demand tier and the console's band, so a file
      saying 25,000 produced a product priced at something else entirely.
    */
    const built = buildBatchGameImport(template("Priced In The File"), "cat_nintendo");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(typesOf(built.payload)).toMatchObject({
      offline_base: { price: 25_000, cost: 18_000 },
      online_base: { price: 32_000, cost: 24_000 },
    });
    // The product's own figures are the offline base tier's, as before.
    expect(built.payload["price"]).toBe(25_000);
    expect(built.payload["cost"]).toBe(18_000);
  });

  it("is saved hidden, like every other batch import", () => {
    const built = buildBatchGameImport(template("Hidden On Arrival"), "cat_nintendo");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload["isHidden"]).toBe(true);
    expect(built.payload["batchImport"]).toBe(true);
  });

  it("never lets the supplier name ride along in the payload", () => {
    // Unchanged by this work, and worth a guard: the payload is what reaches
    // every public serializer.
    const built = buildBatchGameImport(
      template("Named Supplier").replace("price=25000\n", "price=25000\nsupplier_name_zh_cn=塞尔达\n"),
      "cat_nintendo",
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(JSON.stringify(built.payload)).not.toContain("塞尔达");
    expect(built.supplierNameZh.name).toBe("塞尔达");
  });
});

describe("the demand tier, now that it only prices", () => {
  /*
    The legacy archive shape, which the pricing module's own docstring
    describes: one supplier number written into both fields on the offline
    rows, so `price` is not a selling price at all. Honouring it directly would
    sell the game at cost. The engine has to price these, and the tier is how.
  */
  const legacy = `
type.1.id=standard_offline
type.1.name=Regular / Offline
type.1.option_id=offline_account
type.1.price=1750
type.1.cost=1750
type.1.is_infinite_stock=true

type.2.id=standard_online
type.2.name=Standard / Online
type.2.option_id=online_account
type.2.price=25000
type.2.cost=1750
type.2.is_infinite_stock=true
`;

  it("prices a legacy file rather than selling it at the supplier's number", () => {
    const built = buildBatchGameImport(template("Legacy Shape", legacy), "cat_nintendo");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const types = typesOf(built.payload);
    expect(types["offline_base"]!.cost).toBe(1_750);
    expect(types["offline_base"]!.price).toBeGreaterThan(1_750);
  });

  it("refuses to read a half-corrected file as ready-priced", () => {
    /*
      The dangerous middle. An operator gives the offline rows real prices and
      leaves the online rows in the legacy shape, where `price` is the online
      acquisition figure and `cost` is a copy of the offline one:

          offline  price=12000  cost=1750     ← corrected
          online   price=25000  cost=1750     ← legacy: 25,000 is the *cost*

      `price > cost` holds on both, so a naive reading calls the file ready and
      sells the online account for exactly what it cost, showing a 23,250
      margin that does not exist. The copied cost is the tell, and it is the
      same tell `mapSupplierCosts` uses.
    */
    const halfFixed = `
type.1.id=standard_offline
type.1.name=Regular / Offline
type.1.option_id=offline_account
type.1.price=12000
type.1.cost=1750

type.2.id=standard_online
type.2.name=Standard / Online
type.2.option_id=online_account
type.2.price=25000
type.2.cost=1750
`;
    const built = buildBatchGameImport(template("Half Corrected", halfFixed), "cat_nintendo");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const types = typesOf(built.payload);
    // Priced by the engine, which reads 25,000 as the online cost it is.
    expect(types["online_base"]!.cost).toBe(25_000);
    expect(types["online_base"]!.price).toBeGreaterThan(25_000);
  });

  it("leaves every tier priced above what it cost", () => {
    for (const rows of [undefined, legacy]) {
      const built = buildBatchGameImport(template("Margin Everywhere", rows), "cat_nintendo");
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      for (const type of built.payload["types"] as any[]) {
        expect(type.price).toBeGreaterThan(type.cost);
      }
    }
  });
});

describe("numbers that cannot be prices", () => {
  /*
    Found by an adversarial review of this change, and every one of them is a
    hazard the engine never had: it only ever read these fields as costs and
    priced from its own bands, so a nonsense number produced a sane price. A
    stated price goes on the shelf as written.
  */
  const rows = (offline: string, online: string) => `
type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
${offline}

type.2.id=standard_online
type.2.name=النسخة القياسية
type.2.option_id=online_account
${online}
`;

  it("refuses a thousands separator written as a full stop", () => {
    /*
      `12.000` is how a great many people write twelve thousand, and `Number()`
      reads it as twelve. It clears every other test — positive, a margin, no
      legacy fingerprint — and would put a game on the shelf at twelve dinars.
    */
    const built = buildBatchGameImport(
      template(
        "Dotted Thousands",
        rows("type.1.price=12.000\ntype.1.cost=1.250", "type.2.price=20.000\ntype.2.cost=10.000"),
      ),
      "cat_nintendo",
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain("فاصل الآلاف");
  });

  it("refuses a price no game could carry", () => {
    const built = buildBatchGameImport(
      template(
        "Too Cheap",
        rows("type.1.price=800\ntype.1.cost=400", "type.2.price=20000\ntype.2.cost=10000"),
      ),
      "cat_nintendo",
    );
    expect(built.ok).toBe(false);
  });

  it("refuses a file whose extras tier is cheaper than the tier it extends", () => {
    /*
      The tiers are told apart by their order within an account, so a file
      listing its DLC row first comes out with the labels swapped — the dearer
      row named «عادي» and the cheaper one «مع الإضافات». The prices are the
      evidence, and only a file that states them can show it.
    */
    const inverted = `
type.1.id=dlc_offline
type.1.name=مع الإضافات
type.1.option_id=offline_account
type.1.price=30000
type.1.cost=9000

type.2.id=standard_offline
type.2.name=النسخة القياسية
type.2.option_id=offline_account
type.2.price=20000
type.2.cost=6000

type.3.id=standard_online
type.3.name=النسخة القياسية
type.3.option_id=online_account
type.3.price=40000
type.3.cost=28000

type.4.id=dlc_online
type.4.name=مع الإضافات
type.4.option_id=online_account
type.4.price=52000
type.4.cost=33000
`;
    const built = buildBatchGameImport(template("Rows Reversed", inverted), "cat_nintendo");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain("معكوس");
  });

  it("refuses extras on one account and not the other, as the engine does", () => {
    const lopsided = `
type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=20000
type.1.cost=6000

type.2.id=dlc_offline
type.2.name=مع الإضافات
type.2.option_id=offline_account
type.2.price=30000
type.2.cost=9000

type.3.id=standard_online
type.3.name=النسخة القياسية
type.3.option_id=online_account
type.3.price=40000
type.3.cost=28000
`;
    const built = buildBatchGameImport(template("Lopsided", lopsided), "cat_nintendo");
    expect(built.ok).toBe(false);
  });

  it("keeps checking the console even when the file prices itself", () => {
    /*
      Only the engine needs the platform, so it was tempting to ask for it only
      there. It is also the field that says which machine the game runs on.
    */
    const built = buildBatchGameImport(
      template("Wrong Console").replace("platform=switch1", "platform=ps5"),
      "cat_nintendo",
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toContain("منصة");
  });

  it("does not mistake an online cost that equals the offline price for a copy", () => {
    /*
      The legacy fingerprint is a copy of the offline *cost*. Matching against
      the offline price as well would throw away a perfectly ordinary file —
      an online account costing what the offline one sells for is a number a
      shop arrives at honestly.
    */
    const coincidence = `
type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=25000
type.1.cost=18000

type.2.id=standard_online
type.2.name=النسخة القياسية
type.2.option_id=online_account
type.2.price=40000
type.2.cost=25000
`;
    const built = buildBatchGameImport(template("Honest Coincidence", coincidence), "cat_nintendo");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(typesOf(built.payload)).toMatchObject({
      offline_base: { price: 25_000, cost: 18_000 },
      online_base: { price: 40_000, cost: 25_000 },
    });
  });
});

describe("what still refuses", () => {
  it("refuses a file with no name", () => {
    const built = buildBatchGameImport("this file has no fields at all", "cat_nintendo");
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toContain("اسم اللعبة");
  });

  it("refuses a file that states no prices at all", () => {
    /*
      Nothing in the file and nothing the engine can work from. This is the
      refusal that should have been happening all along, and it names the
      missing thing rather than a demand tier.
    */
    const built = buildBatchGameImport(
      template("No Numbers", `
type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=
type.1.cost=
`),
      "cat_nintendo",
    );
    expect(built.ok).toBe(false);
  });
});
