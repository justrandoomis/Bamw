/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./d1.server", () => ({
  d1Ready: async () => false,
  d1All: async () => [],
  d1RawAll: async () => [],
  d1First: async () => null,
  d1Run: async () => {},
  d1RunChanges: async () => 0,
  d1Batch: async () => [],
  d1BatchRun: async () => [],
  getD1: () => undefined,
  ensureSchema: async () => {},
  ensureUsersSchema: async () => {},
}));
vi.mock("./storage.server", () => ({
  listKeys: async () => [],
  mutateJson: async () => undefined,
  readJson: async (_k: string, f: unknown) => f,
  writeJson: async () => undefined,
}));
vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: async () => undefined }));

const store = await import("./db.server");
const { normalizeProductRecord } = store;

const corpus: Record<string, any>[] = [
  { id: "prd_a", title: "Game A", price: 1000, cost: 500, stock: 3 },
  // price/cost/stock as strings
  { id: "prd_b", title: "Game B", price: "1000", cost: "500", stock: "3", sales: "7" },
  // no createdAt, id not prd_
  { id: "cat_x", title: "Accessory", price: 10 },
  // no createdAt, id prd_
  { id: "prd_c", title: "Game C" },
  // julio display url
  { id: "prd_d", title: "Game D", image: "https://switch-images-julio.com/x/display/index.html?code=ABCDE" },
  // known cover id
  { id: "prd_ca9a9392db394624", title: "Known cover" },
  // variants -> types
  { id: "prd_e", title: "Game E", variants: [{ id: "typ_1", name: "Deluxe", description: "supplier note: 1 CNY = 200 IQD" }] },
  // options with polluted description, no internalNote
  { id: "prd_f", title: "Game F", options: [{ id: "opt_1", name: "Mystery", description: "سعر البيع: 7,000 د.ع" }] },
  // options ambiguous name, plain description
  { id: "prd_g", title: "Game G", options: [{ id: "opt_2", name: "Mystery", description: "Some plain text" }] },
  // option with internal_note snake case
  { id: "prd_h", title: "Game H", options: [{ id: "opt_3", name: "Offline", description: "wholesale only", internal_note: "keep" }] },
  // types ambiguous with base-ish description
  { id: "prd_i", title: "Game I", types: [{ id: "typ_2", name: "Mystery", description: "the base standard version" }] },
  // editions
  { id: "prd_j", title: "Game J", editions: [{ id: "typ_3", name: "Ultimate", description: "豪华版" }] },
  // empty devicePerformance array + legacy flat fields
  { id: "prd_k", title: "Game K", devicePerformance: [], perfFps: "60", perfResolutionDocked: "1080p", platform: "switch2" },
  // real devicePerformance
  { id: "prd_l", title: "Game L", devicePerformance: [{ device: "Nintendo Switch 2", deviceSlug: "nintendo-switch-2", handheld: { supported: true, fps: "60" } }] },
  // duplicate devicePerformance entries
  { id: "prd_m", title: "Game M", devicePerformance: [{ device: "Nintendo Switch" }, { device: "Nintendo Switch" }] },
  // title only in english_name
  { id: "prd_n", english_name: "English Only" },
  // titleAr / name
  { id: "prd_o", name: "Name Only", titleAr: "عربي" },
  // slug missing, id present
  { id: "prd_p", title: "Game P" },
  // nulls in arrays
  { id: "prd_q", title: "Game Q", images: ["a", null, "b"], gallery: [null], dlcs: [0, "x"], modes: [""], boxContents: [null, "z"] },
  // hidden / active / status variants
  { id: "prd_r", title: "Game R", isHidden: true, isActive: false, status: "مخفي", displayOrder: 5 },
  // option named Online with desc mentioning offline
  { id: "prd_s", title: "Game S", options: [{ id: "opt_4", name: "Online", description: "offline shared" }] },
  // type whose desc is exactly the DLC constant already
  { id: "prd_t", title: "Game T", types: [{ id: "typ_4", name: "Mystery", description: "اللعبة مع الإضافات" }] },
  // type whose desc is exactly the BASE constant already
  { id: "prd_u", title: "Game U", types: [{ id: "typ_5", name: "Mystery", description: "اللعبة الأساسية" }] },
  // option whose desc is exactly OFFLINE constant already
  { id: "prd_v", title: "Game V", options: [{ id: "opt_5", name: "Mystery", description: "حساب مشترك" }] },
  // option whose desc is exactly ONLINE constant already
  { id: "prd_w", title: "Game W", options: [{ id: "opt_6", name: "Mystery", description: "حساب خاص بك" }] },
  // customerDescription only
  { id: "prd_x", title: "Game X", options: [{ id: "opt_7", name: "Mystery", customerDescription: "CNY 30" }] },
  // box front + cover fields
  { id: "prd_y", title: "Game Y", box_front_url: " https://cdn/x.jpg ", cover_front_url: "https://cdn/y.jpg", cartridgeImage: "https://cdn/z.jpg", coverImage: "https://cdn/w.jpg" },
  // trade-in / commercial extras that must survive untouched
  { id: "prd_z", title: "Game Z", tradeInValue: 4500, infiniteStock: true, displayOrder: 12, sales: 9, hubData: { a: 1 } },
];

describe("normalizeProductRecord idempotency", () => {
  it("second pass is byte-identical to the first", () => {
    const drift: string[] = [];
    for (const p of corpus) {
      const once = normalizeProductRecord(structuredClone(p));
      const twice = normalizeProductRecord(structuredClone(once));
      const thrice = normalizeProductRecord(structuredClone(twice));
      const a = JSON.stringify(once);
      const b = JSON.stringify(twice);
      const c = JSON.stringify(thrice);
      if (a !== b) drift.push(`${p.id} pass1!=pass2\n  1: ${a}\n  2: ${b}`);
      else if (b !== c) drift.push(`${p.id} pass2!=pass3`);
    }
    if (drift.length) console.log(drift.join("\n\n"));
    expect(drift).toEqual([]);
  });

  it("key order is stable too", () => {
    const drift: string[] = [];
    for (const p of corpus) {
      const once = normalizeProductRecord(structuredClone(p));
      const twice = normalizeProductRecord(structuredClone(once));
      const k1 = Object.keys(once).join(",");
      const k2 = Object.keys(twice).join(",");
      if (k1 !== k2) drift.push(`${p.id}\n  1: ${k1}\n  2: ${k2}`);
    }
    if (drift.length) console.log(drift.join("\n\n"));
    expect(drift).toEqual([]);
  });
});
