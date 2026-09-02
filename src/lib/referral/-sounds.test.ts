/**
 * @vitest-environment node
 */
/**
 * The referral screens use the store's own sound library, and nothing else.
 *
 * The sounds are files hosted on Cloudflare (`UI_SOUND_MAP` in
 * `src/config/publicAssets.ts`) and played through `playSound`. The
 * requirement is explicit that no substitute may be synthesised in the
 * browser, so this checks both halves: the real library is called, and no
 * referral surface reaches for an oscillator or builds its own audio.
 *
 * A name in `SoundName` that has no entry in the map plays silence, so the
 * names used are checked against the map itself rather than against the type.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** The surfaces that give a member feedback and therefore should sound. */
const SOUNDING_SURFACES = [
  "src/components/referral/ReferralCartField.tsx",
  "src/components/referral/ShareAndEarnButton.tsx",
  "src/routes/refer.tsx",
];

/** Everything the referral feature renders, sounding or not. */
const ALL_SURFACES = [
  ...SOUNDING_SURFACES,
  "src/components/referral/ReferralCapture.tsx",
  "src/components/admin/ReferralsManager.tsx",
  "src/routes/telegram/referrals.tsx",
];

/** The sound names actually present in the Cloudflare-hosted map. */
function libraryNames(): Set<string> {
  const source = read("src/config/publicAssets.ts");
  const body = source.split("UI_SOUND_MAP: Record<string, string> = {")[1]?.split("\n};")[0] ?? "";
  const names = new Set<string>();
  for (const match of body.matchAll(/^\s*("?)([A-Za-z_][\w. ]*)\1\s*:/gm)) {
    names.add(match[2]!.trim());
  }
  return names;
}

describe("referral sounds", () => {
  it.each(SOUNDING_SURFACES)("%s plays through the store's library", (relative) => {
    const source = read(relative);
    expect(source).toMatch(/import \{ playSound \} from "@\/utils\/audio";/);
    expect(source).toMatch(/playSound\(/);
  });

  it.each(SOUNDING_SURFACES)("%s only names sounds the library actually has", (relative) => {
    const source = read(relative);
    const library = libraryNames();
    const used = [...source.matchAll(/playSound\(\s*"([^"]+)"/g)].map((match) => match[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      // A name missing from the map type-checks and then plays silence.
      expect(library.has(name), `"${name}" is not in UI_SOUND_MAP`).toBe(true);
    }
  });

  it("points the library at Cloudflare rather than at bundled files", () => {
    const source = read("src/config/publicAssets.ts");
    expect(source).toMatch(/UI_SOUND_MAP/);
    expect(source).toMatch(/ASSET_BASE_URL\}\/Audio\/Ui\//);
  });

  it.each(ALL_SURFACES)("%s synthesises no sound of its own", (relative) => {
    const source = read(relative);
    /*
      The three ways a substitute gets built in a browser. None of them may
      appear on a referral surface: the library is the only source of sound.
    */
    expect(source).not.toMatch(/new\s+(webkit)?AudioContext/);
    expect(source).not.toMatch(/createOscillator|OscillatorNode/);
    expect(source).not.toMatch(/new\s+Audio\s*\(/);
  });
});
