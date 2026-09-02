import { describe, expect, it } from "vitest";

import {
  normalizeGameDevicePerformance,
  resolveGamePlatformKey,
  resolvePlatformHardware,
  PLATFORM_DEVICE,
} from "./devicePerformance";

const HARDWARE = [
  {
    id: "prd_switch1",
    title: "Nintendo Switch",
    slug: "nintendo-switch",
    model: "HAC-001(-01)",
    // Device capability fields that must never leak into game records.
    maxResolution: "1080p",
    maxFps: "60",
  },
  {
    id: "prd_switch2",
    title: "Nintendo Switch 2",
    slug: "nintendo-switch-2",
    model: "BEE-001",
    maxResolution: "4K",
    maxFps: "120",
  },
];

describe("resolveGamePlatformKey", () => {
  it("maps every spelling to the two platforms, leading with Switch 2 for both", () => {
    expect(resolveGamePlatformKey("switch1")).toBe("switch1");
    expect(resolveGamePlatformKey("switch")).toBe("switch1");
    expect(resolveGamePlatformKey("Nintendo Switch")).toBe("switch1");
    expect(resolveGamePlatformKey("switch2")).toBe("switch2");
    expect(resolveGamePlatformKey("Nintendo Switch 2")).toBe("switch2");
    expect(resolveGamePlatformKey("both")).toBe("switch2");
    expect(resolveGamePlatformKey(undefined)).toBe("switch1");
  });
});

describe("resolvePlatformHardware", () => {
  it("finds the hardware product and carries its id and model", () => {
    const identity = resolvePlatformHardware("switch2", HARDWARE);
    expect(identity).toEqual({
      device: "Nintendo Switch 2",
      deviceSlug: "nintendo-switch-2",
      hardwareId: "prd_switch2",
      deviceModel: "BEE-001",
    });
  });

  it("still yields the canonical identity when no hardware product exists", () => {
    const identity = resolvePlatformHardware("switch1", []);
    expect(identity.device).toBe(PLATFORM_DEVICE.switch1.name);
    expect(identity.deviceSlug).toBe("nintendo-switch");
    expect(identity.hardwareId).toBeUndefined();
  });
});

describe("normalizeGameDevicePerformance", () => {
  it("gives a switch1 game exactly one Nintendo Switch record automatically", () => {
    const records = normalizeGameDevicePerformance({ platform: "switch1" }, HARDWARE);
    expect(records).toHaveLength(1);
    expect(records[0]!.device).toBe("Nintendo Switch");
    expect(records[0]!.deviceSlug).toBe("nintendo-switch");
    expect(records[0]!.hardwareId).toBe("prd_switch1");
  });

  it("gives a switch2 game exactly one Nintendo Switch 2 record automatically", () => {
    const records = normalizeGameDevicePerformance({ platform: "switch2" }, HARDWARE);
    expect(records).toHaveLength(1);
    expect(records[0]!.deviceSlug).toBe("nintendo-switch-2");
    expect(records[0]!.hardwareId).toBe("prd_switch2");
  });

  it("collapses a legacy two-device game to the platform's device only", () => {
    const records = normalizeGameDevicePerformance(
      {
        platform: "switch2",
        devicePerformance: [
          {
            device: "Nintendo Switch",
            deviceSlug: "nintendo-switch",
            handheld: { supported: true, resolution: "720p", fps: "30" },
            tv: { supported: true, resolution: "1080p", fps: "30" },
          },
          {
            device: "Nintendo Switch 2",
            deviceSlug: "nintendo-switch-2",
            handheld: { supported: true, resolution: "1080p", fps: "60" },
            tv: { supported: true, resolution: "1440p", fps: "60" },
          },
        ],
      },
      HARDWARE,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.deviceSlug).toBe("nintendo-switch-2");
    // The Switch record's numbers describe different silicon and must be gone.
    expect(records[0]!.tv?.resolution).toBe("1440p");
    expect(records[0]!.handheld?.resolution).toBe("1080p");
  });

  it("never blends the other console's figures into the kept record", () => {
    const records = normalizeGameDevicePerformance(
      {
        platform: "switch2",
        devicePerformance: [
          {
            device: "Nintendo Switch",
            deviceSlug: "nintendo-switch",
            upscaling: "None",
            tv: { supported: true, resolution: "1080p", fps: "30" },
          },
          {
            device: "Nintendo Switch 2",
            deviceSlug: "nintendo-switch-2",
            tv: { supported: true, resolution: "2160p", fps: "60" },
          },
        ],
      },
      HARDWARE,
    );
    expect(records[0]!.upscaling).toBeUndefined();
    expect(records[0]!.tv?.resolution).toBe("2160p");
  });

  it("re-badges a game whose only record carries a stale device label", () => {
    const records = normalizeGameDevicePerformance(
      {
        platform: "switch2",
        devicePerformance: [
          {
            device: "Switch OLED",
            deviceSlug: "switch-oled",
            tv: { supported: true, resolution: "1080p", fps: "60" },
          },
        ],
      },
      HARDWARE,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.deviceSlug).toBe("nintendo-switch-2");
    expect(records[0]!.tv?.resolution).toBe("1080p");
  });

  it("changing the platform swaps the device on the next normalization", () => {
    const stored = normalizeGameDevicePerformance({ platform: "switch1" }, HARDWARE);
    const swapped = normalizeGameDevicePerformance(
      { platform: "switch2", devicePerformance: stored },
      HARDWARE,
    );
    expect(swapped).toHaveLength(1);
    expect(swapped[0]!.deviceSlug).toBe("nintendo-switch-2");
    expect(swapped[0]!.hardwareId).toBe("prd_switch2");
  });

  it("is idempotent: normalizing twice yields the same single record", () => {
    const product = {
      platform: "switch1",
      devicePerformance: [
        { device: "Nintendo Switch", deviceSlug: "nintendo-switch", tv: { supported: true } },
        { device: "Nintendo Switch", deviceSlug: "nintendo-switch", handheld: { supported: true } },
      ],
    };
    const once = normalizeGameDevicePerformance(product, HARDWARE);
    const twice = normalizeGameDevicePerformance(
      { ...product, devicePerformance: once },
      HARDWARE,
    );
    expect(twice).toEqual(once);
    expect(twice).toHaveLength(1);
  });

  it("never copies hardware capability fields into the game record", () => {
    const records = normalizeGameDevicePerformance({ platform: "switch2" }, HARDWARE);
    const record = records[0]! as unknown as Record<string, unknown>;
    expect(record["maxResolution"]).toBeUndefined();
    expect(record["maxFps"]).toBeUndefined();
    expect(records[0]!.tv?.resolution).toBeUndefined();
  });

  it("keeps working with an empty hardware catalogue (no picker, no error text)", () => {
    const records = normalizeGameDevicePerformance({ platform: "switch2" }, []);
    expect(records).toHaveLength(1);
    expect(records[0]!.device).toBe("Nintendo Switch 2");
    expect(records[0]!.hardwareId).toBeUndefined();
  });
});
