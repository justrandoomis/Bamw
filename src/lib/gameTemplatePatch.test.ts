import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parseGameImport } from "./gameImportParser";
import { BOOLEAN_ONLY_NOTE, generateGameImportTemplate } from "./gameImportGenerator";
import {
  applyGameImportToForm,
  buildProductSavePayload,
  createBlankProductForm,
} from "./gameImportForm";
import { COVER_TEXTURE_FIELD } from "./coverTexture";

const WRAP = "https://cdn.example.test/wraps/hyrule-warriors-full-wrap.jpg";

const banners = Array.from(
  { length: 10 },
  (_, i) => `banner_image.${i + 1}=https://cdn.example.test/banner-${i + 1}.jpg`,
).join("\n");
const gallery = Array.from(
  { length: 12 },
  (_, i) =>
    `gallery.${i + 1}.image=https://cdn.example.test/shot-${i + 1}.jpg\ngallery.${i + 1}.description=لقطة رسمية ${i + 1}`,
).join("\n");

/**
 * The file the patch has to import cleanly: simple lists written directly,
 * exactly one device performance record, real booleans, a full image set, and
 * hiding declared once at product level.
 */
const SAMPLE = `
schema_version=1
name=Hyrule Warriors Age of Imprisonment
platform=switch2
price=32000
cost=24000
is_infinite_stock=true
is_hidden=false

cover_texture_url=${WRAP}

${banners}

${gallery}

overview_suitable_for.1=محبي ألعاب الأكشن الجماعي
overview_suitable_for.2=لاعبي سلسلة Zelda
overview_not_suitable_for.1=من يبحث عن ألعاب هادئة
feature.1=معارك واسعة بمئات الأعداء
feature.2=طور تعاوني محلي
verdict_pro.1=قتال ممتع ومتنوع
verdict_pro.2=أداء ثابت
verdict_con.1=مهام جانبية متكررة
series_game.1=Hyrule Warriors Definitive Edition
setting_requirement.1=مساحة تخزين 12 غيغابايت

# Booleans that are published get true/false; the rest stay blank.
performance_hdr=true
supports_arabic=false
multiplayer_cooperative=true

device_performance.1.device=Nintendo Switch 2
device_performance.1.device_slug=nintendo-switch-2
device_performance.1.handheld.supported=true
device_performance.1.handheld.output_resolution=1920x1080
device_performance.1.handheld.fps=60
device_performance.1.handheld.hdr=false
device_performance.1.handheld.vrr=true
device_performance.1.tv.supported=true
device_performance.1.tv.output_resolution=3840x2160
device_performance.1.tv.fps=60
device_performance.1.tv.hdr=true
device_performance.1.tv.vrr=
device_performance.1.tv.notes=HDR10 مؤكد من نينتندو

option.1.id=offline_account
option.1.name=حساب أوفلاين
option.1.is_infinite_stock=true
option.2.id=online_account
option.2.name=حساب أونلاين
option.2.is_infinite_stock=true

type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=32000
type.1.is_infinite_stock=true
type.2.id=standard_online
type.2.name=النسخة القياسية
type.2.option_id=online_account
type.2.price=38000
type.2.is_infinite_stock=true
`;

const parsed = () => parseGameImport(SAMPLE);
const blockingErrors = (raw: string) =>
  parseGameImport(raw).errors.filter((issue) => issue.severity === "error");

describe("regression: the sample import file", () => {
  it("imports with no blocking errors and no unknown fields", () => {
    const result = parsed();
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.unknownFields).toEqual([]);
  });

  it("keeps every simple list a list of plain strings — never [object Object]", () => {
    const data = parsed().data;
    expect(data["fitFor"]).toEqual(["محبي ألعاب الأكشن الجماعي", "لاعبي سلسلة Zelda"]);
    expect(data["notFitFor"]).toEqual(["من يبحث عن ألعاب هادئة"]);
    expect(data["features"]).toEqual(["معارك واسعة بمئات الأعداء", "طور تعاوني محلي"]);
    expect(data["verdictPros"]).toEqual(["قتال ممتع ومتنوع", "أداء ثابت"]);
    expect(data["verdictCons"]).toEqual(["مهام جانبية متكررة"]);
    expect(data["seriesEntries"]).toEqual(["Hyrule Warriors Definitive Edition"]);
    expect(data["setupNeeds"]).toEqual(["مساحة تخزين 12 غيغابايت"]);

    for (const target of [
      "fitFor",
      "notFitFor",
      "features",
      "verdictPros",
      "verdictCons",
      "seriesEntries",
      "setupNeeds",
    ]) {
      for (const entry of data[target] as unknown[]) {
        expect(typeof entry).toBe("string");
        expect(String(entry)).not.toContain("[object Object]");
      }
    }
  });

  it("records one device performance entry, not three copies of the same device", () => {
    const records = parsed().data["devicePerformance"] as Record<string, any>[];
    expect(records).toHaveLength(1);
    expect(records[0]!["device"]).toBe("Nintendo Switch 2");
  });

  it("reads booleans as booleans and leaves an unknown one out entirely", () => {
    const data = parsed().data;
    expect(data["perfHdr"]).toBe(true);
    expect(data["arabicSupport"]).toBe(false);
    expect(data["mpCoop"]).toBe(true);

    const device = (data["devicePerformance"] as Record<string, any>[])[0]!;
    expect(device["handheld"].supported).toBe(true);
    expect(device["handheld"].hdr).toBe(false);
    expect(device["handheld"].vrr).toBe(true);
    expect(device["tv"].hdr).toBe(true);
    // Left blank in the file: absent, not false, and not an error.
    expect(device["tv"].vrr).toBeUndefined();
    // The descriptive detail lives in notes, where it belongs.
    expect(device["tv"].notes).toBe("HDR10 مؤكد من نينتندو");
  });

  it("imports all ten banners and all twelve gallery images", () => {
    const data = parsed().data;
    expect(data["bannerImages"]).toHaveLength(10);
    expect((data["bannerImages"] as string[])[9]).toBe("https://cdn.example.test/banner-10.jpg");

    const shots = data["galleryImages"] as Record<string, any>[];
    expect(shots).toHaveLength(12);
    expect(shots[11]!["url"]).toBe("https://cdn.example.test/shot-12.jpg");
    expect(shots[11]!["alt"]).toBe("لقطة رسمية 12");
  });

  it("keeps the full wrap in the 3D texture field", () => {
    const payload = buildProductSavePayload(
      applyGameImportToForm(createBlankProductForm("cat_nintendo"), parsed().data),
    );
    expect(payload[COVER_TEXTURE_FIELD]).toBe(WRAP);
    // The front cover is a different field; the wrap never lands there.
    expect(payload["cartridgeImage"]).toBe("");
  });

  it("hides at product level only — options and types carry no hidden flag", () => {
    const payload = buildProductSavePayload(
      applyGameImportToForm(createBlankProductForm("cat_nintendo"), parsed().data),
    );
    expect(payload["isHidden"]).toBe(false);
    expect(payload["isInfiniteStock"]).toBe(true);

    for (const entry of [
      ...(payload["options"] as Record<string, any>[]),
      ...(payload["types"] as Record<string, any>[]),
    ]) {
      expect(entry).not.toHaveProperty("isHidden");
      expect(entry).not.toHaveProperty("is_hidden");
      // Stock flags stay exactly where they already were.
      expect(entry["isInfiniteStock"]).toBe(true);
    }
  });
});

describe("boolean fields refuse prose and accept blank", () => {
  const withHdr = (value: string) =>
    `schema_version=1\nname=Boolean Game\nplatform=switch1\nperformance_hdr=${value}\n`;

  /*
    These fixtures are one field on a bare header, so they also trip the rule
    that a game must carry a performance record for its own platform. The
    subject here is `performance_hdr`, so the assertions look at that field's
    errors rather than the file's total — otherwise an unrelated rule can break
    a test that is not about it.
  */
  const hdrErrors = (source: string) =>
    blockingErrors(source).filter((issue) => issue.key === "performance_hdr");

  it.each(["Not Published", "Unknown", "N/A", "HDR10", "Yes", "Nintendo Switch 2"])(
    "rejects %s and says what to write instead",
    (bad) => {
      const errors = hdrErrors(withHdr(bad));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("true");
      expect(errors[0]!.message).toContain("false");
      expect(errors[0]!.message).toContain("فارغاً");
    },
  );

  it("accepts true, false and blank", () => {
    expect(hdrErrors(withHdr("true"))).toEqual([]);
    expect(hdrErrors(withHdr("false"))).toEqual([]);
    expect(hdrErrors(withHdr(""))).toEqual([]);
    expect(parseGameImport(withHdr("")).data["perfHdr"]).toBeUndefined();
  });
});

describe("the same device may not be repeated across indexes", () => {
  it("refuses a file that copies one device into two slots", () => {
    const errors = blockingErrors(`
schema_version=1
name=Duplicated Device Game
platform=switch2
device_performance.1.device=Nintendo Switch 2
device_performance.1.handheld.output_resolution=1920x1080
device_performance.1.handheld.fps=60
device_performance.1.tv.output_resolution=3840x2160
device_performance.1.tv.fps=60
device_performance.2.device=Nintendo Switch 2
device_performance.2.handheld.output_resolution=1920x1080
device_performance.2.handheld.fps=60
device_performance.2.tv.output_resolution=3840x2160
device_performance.2.tv.fps=60
`);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/Duplicate performance record/i);
  });

  it("accepts two genuinely different devices", () => {
    expect(
      blockingErrors(`
schema_version=1
name=Two Device Game
platform=both
device_performance.1.device=Nintendo Switch
device_performance.1.handheld.output_resolution=1280x720
device_performance.1.handheld.fps=30
device_performance.1.tv.output_resolution=1920x1080
device_performance.1.tv.fps=30
device_performance.2.device=Nintendo Switch 2
device_performance.2.handheld.output_resolution=1920x1080
device_performance.2.handheld.fps=60
device_performance.2.tv.output_resolution=3840x2160
device_performance.2.tv.fps=60
`),
    ).toEqual([]);
  });
});

describe("older files keep working", () => {
  it("still reads the .value form and flattens it to the same strings", () => {
    const legacy = parseGameImport(`
schema_version=1
name=Legacy List Game
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures for this title.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
feature.1.value=ميزة أولى
feature.2.value=ميزة ثانية
verdict_pro.1.value=إيجابية
setting_requirement.1.value=متطلب
`);
    expect(legacy.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(legacy.data["features"]).toEqual(["ميزة أولى", "ميزة ثانية"]);
    expect(legacy.data["verdictPros"]).toEqual(["إيجابية"]);
    expect(legacy.data["setupNeeds"]).toEqual(["متطلب"]);
  });
});

describe("the shipped template teaches the corrected shapes", () => {
  const template = generateGameImportTemplate();

  it("matches the file served to admins", () => {
    expect(readFileSync("public/templates/nintendo-switch-game-template.txt", "utf-8")).toBe(
      template,
    );
  });

  it("writes simple lists directly, with no .value anywhere", () => {
    for (const key of [
      "overview_suitable_for",
      "overview_not_suitable_for",
      "feature",
      "verdict_pro",
      "verdict_con",
      "series_game",
      "setting_requirement",
    ]) {
      expect(template).toContain(`${key}.1=\n`);
      expect(template).not.toContain(`${key}.1.value=`);
    }
    expect(template).not.toContain(".value=");
  });

  it("leaves genuinely structured groups structured", () => {
    for (const line of [
      "review.1.source=",
      "review.1.score=",
      // A long quote is a heredoc field, not a one-liner.
      "review.1.quote<<EOF",
      "review.1.url=",
      "dlc.1.title=",
      "video.1.title=",
      "video.1.url=",
      "story_chapter.1.title=",
      "device_performance.1.device=",
      "gallery.1.image=",
      "gallery.1.description=",
    ]) {
      expect(template).toContain(line);
    }
  });

  it("marks boolean groups and states the device rule", () => {
    expect(template).toContain(`# ${BOOLEAN_ONLY_NOTE}`);
    expect(template).toContain("# ONE DEVICE PER INDEX");
    expect(template).toContain("Never repeat the same device across indexes");
  });

  it("offers ten banners and twelve gallery slots as examples", () => {
    expect(template).toContain("banner_image.10=");
    expect(template).not.toContain("banner_image.11=");
    expect(template).toContain("gallery.12.image=");
    expect(template).not.toContain("gallery.13.image=");
  });

  it("parses indexes beyond what the template prints", () => {
    const beyond = parseGameImport(`
schema_version=1
name=Many Images Game
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures for this title.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
banner_image.11=https://cdn.example.test/banner-11.jpg
banner_image.12=https://cdn.example.test/banner-12.jpg
gallery.13.image=https://cdn.example.test/shot-13.jpg
gallery.14.image=https://cdn.example.test/shot-14.jpg
`);
    expect(beyond.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(beyond.data["bannerImages"]).toHaveLength(12);
    expect(beyond.data["galleryImages"]).toHaveLength(14);
  });

  it("never offers a hidden flag on an option or a type", () => {
    expect(template).toContain("is_hidden=false");
    expect(template).not.toMatch(/option\.\d+\.is_hidden/);
    expect(template).not.toMatch(/type\.\d+\.is_hidden/);
    // Stock, which does belong there, is untouched.
    expect(template).toContain("option.1.is_infinite_stock=true");
    expect(template).toContain("type.1.is_infinite_stock=true");
  });

  it("keeps the 3D texture fields pointing at the full wrap", () => {
    expect(template).toContain("front_cover_hires_url=");
    expect(template).toContain("cover_texture_url=");
    expect(template).toContain("Back Cover + Spine + Front Cover");
  });
});
