/**
 * Entry point bundled for the R2 relocation.
 *
 * Deliberately the smallest entry in `scripts/lib/`: this script READS the
 * catalogue to learn which files the shop references and then touches nothing
 * but R2. It has no business importing `updateStore`, so it does not — an
 * entry that cannot write the catalogue cannot write it by accident.
 */
export { d1All } from "@/lib/d1.server";
export { getStore } from "@/lib/db.server";
