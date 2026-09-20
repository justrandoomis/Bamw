import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parseGameImport } from "./gameImportParser";
import { generateGameImportTemplate } from "./gameImportGenerator";
import {
  getDevicePerformanceList,
  performanceMatches,
  performanceSummary,
  validateGameDevicePerformance,
} from "./devicePerformance";

const errors = (raw: string) =>
  parseGameImport(raw).errors.filter((issue) => issue.severity === "error");

describe("game sale price import", () => {
  it("keeps before/after prices for the product, option and type", () => {
    const result = parseGameImport(`
schema_version=1
name=Discounted Game
platform=switch1
price=9000
original_price=15000
option.1.id=offline_account
option.1.name=Offline
option.1.price=9000
option.1.original_price=15000
type.1.id=offline_extras
type.1.name=Offline + DLC
type.1.option_id=offline_account
type.1.price=12500
type.1.original_price=20000
`);

    expect(result.unknownFields).toEqual([]);
    expect(result.data["originalPrice"]).toBe(15000);
    expect(result.data["options"]).toEqual([
      expect.objectContaining({ price: 9000, originalPrice: 15000 }),
    ]);
    expect(result.data["types"]).toEqual([
      expect.objectContaining({ price: 12500, originalPrice: 20000 }),
    ]);
  });
});

describe("game device performance import", () => {
  it("keeps the generated template in sync with deeply nested fields", () => {
    const template = generateGameImportTemplate();
    expect(template).toContain("# DEVICE PERFORMANCE");
    expect(template).toContain("device_performance.1.handheld.rendering_resolution=");
    expect(template).toContain("device_performance.3.mode.3.tv_fps=");
  });

  it("parses multiple devices and unlimited nested performance modes", () => {
    const result = parseGameImport(`
schema_version=1
name=Verified Test Game
platform=switch2
device_performance.1.device=Nintendo Switch 2
device_performance.1.device_slug=nintendo-switch-2
device_performance.1.device_model=BEE-001
device_performance.1.handheld.supported=true
device_performance.1.handheld.rendering_resolution=1920x1080
device_performance.1.handheld.output_resolution=1920x1080
device_performance.1.handheld.fps=60
device_performance.1.handheld.hdr=false
device_performance.1.handheld.vrr=true
device_performance.1.tv.supported=true
device_performance.1.tv.rendering_resolution=2560x1440
device_performance.1.tv.output_resolution=3840x2160
device_performance.1.tv.fps=60
device_performance.1.tv.hdr=true
device_performance.1.mode.1.name=Quality Mode
device_performance.1.mode.1.tv_resolution=3840x2160
device_performance.1.mode.1.tv_fps=30
device_performance.1.mode.27.name=Performance Mode
device_performance.1.mode.27.tv_resolution=2560x1440
device_performance.1.mode.27.tv_fps=60
device_performance.1.source_name=Publisher
device_performance.1.source_url=https://example.com/patch
device_performance.1.verification_status=official
device_performance.2.device=Nintendo Switch
device_performance.2.device_slug=nintendo-switch
device_performance.2.handheld.supported=false
device_performance.2.tv.supported=false
`);

    expect(result.unknownFields).toEqual([]);
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    const records = getDevicePerformanceList(result.data);
    expect(records).toHaveLength(2);
    expect(records[0]?.modes).toHaveLength(2);
    expect(records[0]?.modes?.[1]).toMatchObject({
      name: "Performance Mode",
      tvResolution: "2560x1440",
      tvFps: "60",
    });
    expect(performanceSummary(records[0]!)).toContain("1920x1080");
    expect(performanceSummary(records[0]!)).toContain("3840x2160");
  });

  it("rejects a Switch 2 game with missing performance fields", () => {
    const result = errors(`schema_version=1\nname=Incomplete\nplatform=switch2`);
    expect(result.some((issue) => issue.key === "device_performance")).toBe(true);
    expect(result[0]?.message).toContain("Nintendo Switch 2 performance information is required");
  });

  it("also requires performance when compatibility names Nintendo Switch 2", () => {
    const result = errors(
      `schema_version=1\nname=Compatibility Test\nplatform=switch1\ncompatibility.1=Nintendo Switch 2`,
    );
    expect(result.some((issue) => issue.key === "device_performance")).toBe(true);
  });

  it("accepts a mode explicitly marked Not Supported", () => {
    const result = parseGameImport(`
schema_version=1
name=TV-only Test
platform=switch2
device_performance.1.device=Nintendo Switch 2
device_performance.1.device_slug=nintendo-switch-2
device_performance.1.handheld.supported=false
device_performance.1.tv.supported=true
device_performance.1.tv.resolution=1440p
device_performance.1.tv.fps=30-60
`);
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("allows not-published status only with reason, source and verification state", () => {
    const base = {
      platform: "switch2",
      devicePerformance: [
        {
          device: "Nintendo Switch 2",
          deviceSlug: "nintendo-switch-2",
          informationStatus: "not_published",
        },
      ],
    };
    expect(validateGameDevicePerformance(base)[0]?.message).toContain("unavailable_reason");
    expect(
      validateGameDevicePerformance({
        ...base,
        devicePerformance: [
          {
            ...base.devicePerformance[0],
            unavailableReason: "Publisher has not published figures.",
            sourceName: "Publisher support",
            verificationStatus: "official",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects duplicate active records for the same game and hardware", () => {
    const issues = validateGameDevicePerformance({
      platform: "switch2",
      devicePerformance: [
        { device: "Nintendo Switch 2", deviceSlug: "nintendo-switch-2" },
        { device: "Nintendo Switch 2", deviceSlug: "nintendo-switch-2" },
      ],
    });
    expect(issues[0]?.message).toContain("Duplicate performance record");
  });

  it("keeps old non-Switch-2 files backwards compatible", () => {
    const result = parseGameImport(`
schema_version=1
name=Legacy Game
platform=switch1
performance_tv_resolution=1080p
performance_handheld_resolution=720p
performance_fps=30
`);
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(getDevicePerformanceList(result.data)[0]?.deviceSlug).toBe("nintendo-switch");
  });

  it("keeps scalar edition and legacy repeated-group shorthand compatible", () => {
    const result = parseGameImport(`
schema_version=1
name=Legacy Shapes
platform=switch1
edition=Ultimate Edition
edition.1.name=Ultimate Edition
edition.1.content=Base game and expansion
feature.50=Legacy shorthand feature
`);
    expect(result.unknownFields).toEqual([]);
    expect(result.data.edition).toBe("Ultimate Edition");
    expect(result.data.editionsList?.[0]).toMatchObject({
      name: "Ultimate Edition",
      contents: [{ label: "Base game and expansion" }],
    });
    expect(result.data.features).toEqual(["Legacy shorthand feature"]);
  });

  it("filters by actual FPS and resolution values rather than hardware maxima", () => {
    const record = getDevicePerformanceList({
      devicePerformance: [
        {
          device: "Nintendo Switch 2",
          deviceSlug: "nintendo-switch-2",
          handheld: { supported: true, resolutionDynamic: "900p-1080p", fps: "30-60" },
          tv: { supported: true, outputResolution: "2560x1440", fps: "60" },
        },
      ],
    })[0]!;
    expect(performanceMatches(record, ["30", "1080p"])).toBe(true);
    expect(performanceMatches(record, ["60", "1440p"])).toBe(true);
    expect(performanceMatches(record, ["120"])).toBe(false);
    expect(performanceMatches(record, ["4k"])).toBe(false);
  });

  it("imports the real Cyberpunk Switch 2 fixture with the same two-way performance data", () => {
    const result = parseGameImport(readFileSync("cyberpunk_template.txt", "utf8"));
    const record = getDevicePerformanceList(result.data)[0];
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.unknownFields).toEqual([]);
    expect(record?.deviceSlug).toBe("nintendo-switch-2");
    expect(record?.handheld).toMatchObject({ fps: "30-40", vrr: true });
    expect(record?.tv?.resolution).toContain("1080p");
    expect(record?.modes?.map((mode) => mode.name)).toEqual(["Quality Mode", "Performance Mode"]);
    expect(record?.sourceUrl).toContain("support.cdprojektred.com");
  });
});
