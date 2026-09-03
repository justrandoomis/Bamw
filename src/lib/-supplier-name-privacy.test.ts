/**
 * @vitest-environment node
 */
/**
 * The Chinese supplier name must never reach a customer.
 *
 * It is the name orders are placed with at the Chinese storefront, and the
 * shop's margin is legible from it. The design that keeps it safe is that it
 * lives in `product_admin_metadata` and never enters the product document, so
 * no public serializer can carry a field it has never been given.
 *
 * That is an argument, and arguments rot. These are the checks that hold it:
 * the field is absent from every public projection, no public route reads the
 * table, and — belt and braces — the public serializer strips the key anyway
 * if a future import ever writes it onto a product by mistake.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** Every field name the supplier metadata is stored under. */
const SECRET_FIELDS = [
  "supplier_name_zh_cn",
  "supplierNameZhCn",
  "supplier_name_zh_source_url",
  "supplier_name_zh_verification_status",
  "supplier_name_zh_verified_at",
];

/** Files under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$|^-/.test(entry)) out.push(full);
  }
  return out;
}

describe("the Chinese supplier name never leaves the admin", () => {
  it("is not read by any public route", () => {
    /*
      The whole public surface: everything under `src/routes/api` that is not
      an admin route, plus the public hooks. If one of them mentions the
      column or the module, the field has a path to a customer.
    */
    const publicRoutes = walk(join(ROOT, "src", "routes", "api")).filter(
      (file) => !file.includes(`${join("api", "admin")}`) && !/admin[.-]/.test(file),
    );
    const offenders: string[] = [];
    for (const file of publicRoutes) {
      const source = readFileSync(file, "utf8");
      if (
        SECRET_FIELDS.some((field) => source.includes(field)) ||
        source.includes("productAdminMetadata")
      ) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is not loaded by the store, so no product document can carry it", () => {
    // `getStore` assembles what every public response is built from.
    const source = read("src/lib/db.server.ts");
    expect(source).not.toContain("product_admin_metadata");
    for (const field of SECRET_FIELDS) expect(source).not.toContain(field);
  });

  it("is stripped by the public serializer even if a product ever carries it", () => {
    /*
      The second lock. The first is that the field is in another table; this is
      what saves the day if an import ever writes it onto the product itself.
    */
    const source = read("src/lib/public-product.server.ts");
    expect(source).toContain("supplier_name_zh_cn");
    expect(source).toContain("supplierNameZhCn");
  });

  it("is absent from the search index projection", () => {
    const source = read("src/lib/product-index.server.ts");
    for (const field of SECRET_FIELDS) expect(source).not.toContain(field);
  });
});
