/**
 * Canonical game-on-device performance model.
 *
 * Hardware products describe maximum capabilities. These records describe what
 * a specific game actually does on a specific device. Never derive one from the
 * other: the game record is the source of truth and the D1 relationship tables
 * are only an indexed/history projection of this data.
 */

export type VerificationStatus = "verified" | "official" | "technical_analysis" | "unverified";
export type PerformanceInformationStatus = "available" | "not_published" | "not_tested";

export interface DeviceModePerformance {
  supported?: boolean;
  resolution?: string;
  /** Whether the resolution is dynamic. The values themselves live in the
   *  resolution / renderingResolution / outputResolution fields. */
  resolutionDynamic?: boolean;
  renderingResolution?: string;
  outputResolution?: string;
  fps?: string;
  fpsMin?: string;
  fpsMax?: string;
  refreshRate?: string;
  hdr?: boolean;
  vrr?: boolean;
  mode?: string;
  notes?: string;
}

export interface NamedPerformanceMode {
  name: string;
  handheldResolution?: string;
  handheldFps?: string;
  tvResolution?: string;
  tvFps?: string;
  hdr?: boolean;
  vrr?: boolean;
  notes?: string;
}

export interface DevicePerformance {
  device: string;
  deviceSlug: string;
  deviceModel?: string;
  hardwareId?: string;
  informationStatus?: PerformanceInformationStatus;
  unavailableReason?: string;
  handheld?: DeviceModePerformance;
  tv?: DeviceModePerformance;
  modes?: NamedPerformanceMode[];
  upscaling?: string;
  rayTracing?: boolean;
  rayTracingMode?: string;
  loadingTime?: string;
  loadingNotes?: string;
  gameVersion?: string;
  patchVersion?: string;
  testedDate?: string;
  sourceName?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  verificationStatus?: VerificationStatus;
  performanceNotes?: string;
}

export interface PerformanceValidationIssue {
  key: string;
  message: string;
  severity: "error" | "warning";
}

type Record_ = Record<string, unknown>;

const text = (value: unknown): string =>
  value == null || typeof value === "object" ? "" : String(value).trim();

const bool = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
};

const compact = <T extends object>(value: T): T => {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const entry = record[key];
    if (entry === undefined || entry === null || entry === "") delete record[key];
    else if (Array.isArray(entry)) {
      const filtered = entry.filter(Boolean);
      if (filtered.length === 0) delete record[key];
      else record[key] = filtered;
    }
  }
  return value;
};

export function slugifyDevice(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/nintendo\s+switch\s*ii\b/g, "nintendo switch 2")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeDeviceMode(value: unknown): DeviceModePerformance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record_;

  /*
    `resolutionDynamic` is a flag. Records written while it was a free-text
    field hold a range there instead ("468p-648p"), so that value is moved into
    `resolution` when nothing else filled it and the flag is read as true — the
    range was only ever written to say the resolution is dynamic. Nothing is
    rewritten in storage; this happens each time a record is read.
  */
  const rawDynamic = input["resolutionDynamic"] ?? input["resolution_dynamic"];
  const dynamicFlag = bool(rawDynamic);
  const legacyRange = dynamicFlag === undefined ? text(rawDynamic) : "";

  const normalized = compact({
    supported: bool(input["supported"]),
    resolution: text(input["resolution"]) || legacyRange,
    resolutionDynamic: dynamicFlag ?? (legacyRange ? true : undefined),
    renderingResolution: text(input["renderingResolution"] ?? input["rendering_resolution"]),
    outputResolution: text(input["outputResolution"] ?? input["output_resolution"]),
    fps: text(input["fps"]),
    fpsMin: text(input["fpsMin"] ?? input["fps_min"]),
    fpsMax: text(input["fpsMax"] ?? input["fps_max"]),
    refreshRate: text(input["refreshRate"] ?? input["refresh_rate"]),
    hdr: bool(input["hdr"]),
    vrr: bool(input["vrr"]),
    mode: text(input["mode"]),
    notes: text(input["notes"]),
  } as Record_) as unknown as DeviceModePerformance;
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeNamedMode(value: unknown): NamedPerformanceMode | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record_;
  const normalized = compact({
    name: text(input["name"]),
    handheldResolution: text(input["handheldResolution"] ?? input["handheld_resolution"]),
    handheldFps: text(input["handheldFps"] ?? input["handheld_fps"]),
    tvResolution: text(input["tvResolution"] ?? input["tv_resolution"]),
    tvFps: text(input["tvFps"] ?? input["tv_fps"]),
    hdr: bool(input["hdr"]),
    vrr: bool(input["vrr"]),
    notes: text(input["notes"]),
  } as Record_) as unknown as NamedPerformanceMode;
  return normalized.name ? normalized : undefined;
}

export function normalizeDevicePerformance(value: unknown): DevicePerformance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record_;
  const device = text(input["device"] ?? input["deviceName"] ?? input["device_name"]);
  const deviceSlug =
    slugifyDevice(input["deviceSlug"] ?? input["device_slug"]) || slugifyDevice(device);
  if (!device && !deviceSlug) return undefined;

  const rawModes = Array.isArray(input["modes"])
    ? input["modes"]
    : Array.isArray(input["mode"])
      ? input["mode"]
      : [];
  const modes = rawModes.map(normalizeNamedMode).filter(Boolean) as NamedPerformanceMode[];

  return compact({
    device: device || deviceSlug,
    deviceSlug,
    deviceModel: text(input["deviceModel"] ?? input["device_model"]),
    hardwareId: text(input["hardwareId"] ?? input["hardware_id"]),
    informationStatus: text(
      input["informationStatus"] ?? input["information_status"],
    ) as PerformanceInformationStatus,
    unavailableReason: text(input["unavailableReason"] ?? input["unavailable_reason"]),
    handheld: normalizeDeviceMode(input["handheld"]),
    tv: normalizeDeviceMode(input["tv"]),
    modes: modes.length ? modes : undefined,
    upscaling: text(input["upscaling"]),
    rayTracing: bool(input["rayTracing"] ?? input["ray_tracing"]),
    rayTracingMode: text(input["rayTracingMode"] ?? input["ray_tracing_mode"]),
    loadingTime: text(input["loadingTime"] ?? input["loading_time"]),
    loadingNotes: text(input["loadingNotes"] ?? input["loading_notes"]),
    gameVersion: text(input["gameVersion"] ?? input["game_version"]),
    patchVersion: text(input["patchVersion"] ?? input["patch_version"]),
    testedDate: text(input["testedDate"] ?? input["tested_date"]),
    sourceName: text(input["sourceName"] ?? input["source_name"]),
    sourceUrl: text(input["sourceUrl"] ?? input["source_url"]),
    verifiedAt: text(input["verifiedAt"] ?? input["verified_at"]),
    verificationStatus: text(
      input["verificationStatus"] ?? input["verification_status"],
    ) as VerificationStatus,
    performanceNotes: text(input["performanceNotes"] ?? input["performance_notes"]),
  } as Record_) as unknown as DevicePerformance;
}

export function getDevicePerformanceList(product: Record_ | null | undefined): DevicePerformance[] {
  if (!product || typeof product !== "object") return [];
  const source = product["devicePerformance"] ?? product["device_performance"];
  const normalized = (Array.isArray(source) ? source : source ? [source] : [])
    .map(normalizeDevicePerformance)
    .filter(Boolean) as DevicePerformance[];

  if (normalized.length) return dedupeDevicePerformance(normalized);

  // Backward compatibility for the pre-v2 flat performance fields. These are
  // only read when no new records exist, and their values are never expanded
  // from hardware capability data.
  const platform = normalizePlatform(product["platform"]);
  const docked = text(product["perfResolutionDocked"] ?? product["performance_tv_resolution"]);
  const handheld = text(
    product["perfResolutionHandheld"] ?? product["performance_handheld_resolution"],
  );
  const fps = text(product["perfFps"] ?? product["performance_fps"]);
  const hasLegacy = docked || handheld || fps || "perfHdr" in product;
  if (!hasLegacy) return [];

  const switch2 = platform === "switch2" || platform === "both";
  return [
    {
      device: switch2 ? "Nintendo Switch 2" : "Nintendo Switch",
      deviceSlug: switch2 ? "nintendo-switch-2" : "nintendo-switch",
      handheld: handheld || fps ? { supported: true, resolution: handheld, fps } : undefined,
      tv: docked || fps ? { supported: true, resolution: docked, fps } : undefined,
      ...(typeof product["perfHdr"] === "boolean"
        ? {
            handheld: {
              supported: true,
              resolution: handheld,
              fps,
              hdr: product["perfHdr"] as boolean,
            },
            tv: {
              supported: true,
              resolution: docked,
              fps,
              hdr: product["perfHdr"] as boolean,
            },
          }
        : {}),
      performanceNotes: text(product["perfNotes"]),
      verificationStatus: "unverified",
    },
  ];
}

function calculateRecordCompleteness(record: DevicePerformance): number {
  let score = 0;
  if (record.informationStatus === "available") score += 2;
  if (record.handheld?.supported !== undefined) score += 1;
  if (record.handheld?.resolution) score += 2;
  if (record.handheld?.fps) score += 2;
  if (record.tv?.supported !== undefined) score += 1;
  if (record.tv?.resolution) score += 2;
  if (record.tv?.fps) score += 2;
  if (record.modes?.length) score += record.modes.length * 2;
  if (record.verificationStatus && record.verificationStatus !== "unverified") score += 3;
  if (record.sourceName || record.sourceUrl) score += 1;
  if (record.testedDate || record.verifiedAt) score += 2;
  return score;
}

function mergeModePerformance(
  secondary?: DeviceModePerformance,
  primary?: DeviceModePerformance,
): DeviceModePerformance | undefined {
  if (!primary && !secondary) return undefined;
  if (!primary) return secondary;
  if (!secondary) return primary;

  const merged: DeviceModePerformance = {
    supported: primary.supported !== undefined ? primary.supported : secondary.supported,
    resolution: primary.resolution || secondary.resolution,
    resolutionDynamic:
      primary.resolutionDynamic !== undefined
        ? primary.resolutionDynamic
        : secondary.resolutionDynamic,
    renderingResolution: primary.renderingResolution || secondary.renderingResolution,
    outputResolution: primary.outputResolution || secondary.outputResolution,
    fps: primary.fps || secondary.fps,
    fpsMin: primary.fpsMin || secondary.fpsMin,
    fpsMax: primary.fpsMax || secondary.fpsMax,
    refreshRate: primary.refreshRate || secondary.refreshRate,
    hdr: primary.hdr !== undefined ? primary.hdr : secondary.hdr,
    vrr: primary.vrr !== undefined ? primary.vrr : secondary.vrr,
    mode: primary.mode || secondary.mode,
    notes: [primary.notes, secondary.notes]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(" | "),
  };

  return compact(merged);
}

function mergeNamedModes(
  secondary?: NamedPerformanceMode[],
  primary?: NamedPerformanceMode[],
): NamedPerformanceMode[] | undefined {
  if (!primary && !secondary) return undefined;
  if (!primary || !primary.length) return secondary;
  if (!secondary || !secondary.length) return primary;

  const modeMap = new Map<string, NamedPerformanceMode>();
  for (const m of secondary) {
    if (m && m.name) modeMap.set(m.name.toLowerCase().trim(), m);
  }
  for (const m of primary) {
    if (!m || !m.name) continue;
    const key = m.name.toLowerCase().trim();
    const existing = modeMap.get(key);
    if (existing) {
      modeMap.set(key, {
        name: m.name || existing.name,
        handheldResolution: m.handheldResolution || existing.handheldResolution,
        handheldFps: m.handheldFps || existing.handheldFps,
        tvResolution: m.tvResolution || existing.tvResolution,
        tvFps: m.tvFps || existing.tvFps,
        hdr: m.hdr !== undefined ? m.hdr : existing.hdr,
        vrr: m.vrr !== undefined ? m.vrr : existing.vrr,
        notes: [m.notes, existing.notes]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(" | "),
      });
    } else {
      modeMap.set(key, m);
    }
  }
  const result = [...modeMap.values()];
  return result.length ? result : undefined;
}

export function mergeDevicePerformanceRecords(
  existing: DevicePerformance,
  incoming: DevicePerformance,
): DevicePerformance {
  const existingScore = calculateRecordCompleteness(existing);
  const incomingScore = calculateRecordCompleteness(incoming);

  const primary = incomingScore >= existingScore ? incoming : existing;
  const secondary = incomingScore >= existingScore ? existing : incoming;

  const merged: DevicePerformance = {
    ...secondary,
    ...primary,
    device: primary.device || secondary.device,
    deviceSlug: primary.deviceSlug || secondary.deviceSlug,
    deviceModel: primary.deviceModel || secondary.deviceModel,
    hardwareId: primary.hardwareId || secondary.hardwareId,
    informationStatus: primary.informationStatus || secondary.informationStatus,
    unavailableReason: primary.unavailableReason || secondary.unavailableReason,
    handheld: mergeModePerformance(secondary.handheld, primary.handheld),
    tv: mergeModePerformance(secondary.tv, primary.tv),
    modes: mergeNamedModes(secondary.modes, primary.modes),
    upscaling: primary.upscaling || secondary.upscaling,
    rayTracing: primary.rayTracing !== undefined ? primary.rayTracing : secondary.rayTracing,
    rayTracingMode: primary.rayTracingMode || secondary.rayTracingMode,
    loadingTime: primary.loadingTime || secondary.loadingTime,
    loadingNotes: primary.loadingNotes || secondary.loadingNotes,
    gameVersion: primary.gameVersion || secondary.gameVersion,
    patchVersion: primary.patchVersion || secondary.patchVersion,
    testedDate: primary.testedDate || secondary.testedDate,
    sourceName: primary.sourceName || secondary.sourceName,
    sourceUrl: primary.sourceUrl || secondary.sourceUrl,
    verifiedAt: primary.verifiedAt || secondary.verifiedAt,
    verificationStatus: primary.verificationStatus || secondary.verificationStatus,
    performanceNotes: [primary.performanceNotes, secondary.performanceNotes]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(" | "),
  };

  return compact(merged);
}

export function dedupeDevicePerformance(records: DevicePerformance[]): DevicePerformance[] {
  const byDevice = new Map<string, DevicePerformance>();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const key = record.hardwareId || record.deviceSlug || slugifyDevice(record.device);
    if (!key) continue;

    const existing = byDevice.get(key);
    if (existing) {
      console.warn(`[dedupeDevicePerformance] Merging duplicate performance record for "${key}"`);
      byDevice.set(key, mergeDevicePerformanceRecords(existing, record));
    } else {
      byDevice.set(key, record);
    }
  }
  return [...byDevice.values()];
}

export function normalizePlatform(value: unknown): "switch" | "switch2" | "both" | string {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (["switch2", "nintendoswitch2", "ns2"].includes(normalized)) return "switch2";
  if (["both", "switch1andswitch2", "switchswitch2"].includes(normalized)) return "both";
  if (["switch", "switch1", "nintendoswitch", "ns"].includes(normalized)) return "switch";
  return normalized;
}

export function productSupportsSwitch2(product: Record_ | null | undefined): boolean {
  if (!product || typeof product !== "object") return false;
  const platform = normalizePlatform(product["platform"]);
  if (platform === "switch2" || platform === "both") return true;

  const compatibility = product["compatibility"];
  const values = Array.isArray(compatibility)
    ? compatibility
    : compatibility
      ? [compatibility]
      : [];
  return values.some((item) => {
    if (typeof item === "string") return /nintendo\s*switch\s*2|switch\s*2/i.test(item);
    if (!item || typeof item !== "object") return false;
    return /nintendo\s*switch\s*2|switch\s*2/i.test(
      Object.values(item as Record_)
        .filter((entry) => typeof entry === "string")
        .join(" "),
    );
  });
}

function modeMissing(mode: DeviceModePerformance | undefined, prefix: string): string[] {
  if (mode?.supported === false) return [];
  const missing: string[] = [];
  const resolution = mode?.outputResolution || mode?.resolution;
  if (!resolution) missing.push(`${prefix}.resolution`);
  if (!mode?.fps) missing.push(`${prefix}.fps`);
  return missing;
}

export function validateGameDevicePerformance(
  product: Record_ | null | undefined,
  options?: { strict?: boolean },
): PerformanceValidationIssue[] {
  if (!product || typeof product !== "object") return [];
  const source = product["devicePerformance"] ?? product["device_performance"];
  const rawRecords = (Array.isArray(source) ? source : source ? [source] : [])
    .map(normalizeDevicePerformance)
    .filter(Boolean) as DevicePerformance[];
  const identities = rawRecords.map(
    (record) => record.hardwareId || record.deviceSlug || slugifyDevice(record.device),
  );
  const duplicate = identities.find(
    (identity, index) => identity && identities.indexOf(identity) !== index,
  );
  const issues: PerformanceValidationIssue[] = [];
  if (duplicate) {
    console.warn(`[validateGameDevicePerformance] Duplicate performance record detected for ${duplicate}; merging automatically.`);
    issues.push({
      key: "device_performance",
      severity: options?.strict ? "error" : "warning",
      message: `Duplicate performance record for ${duplicate}. Keep one active record per game and hardware device.`,
    });
  }

  /*
    A game owns exactly one performance record: the one for its platform's
    device. A Switch 1 game whose compatibility notes mention Switch 2 still
    validates against its Nintendo Switch record — compatibility text never
    creates a second device requirement.
  */
  const requiredDevice = PLATFORM_DEVICE[resolveGamePlatformKey(product["platform"])];
  const records = getDevicePerformanceList(product);
  const record =
    records.find((item) => item.deviceSlug === requiredDevice.slug) ??
    (records.length === 1 ? records[0] : undefined);
  if (!record) {
    issues.push({
      key: "device_performance",
      severity: "error",
      message: `${requiredDevice.name} performance information is required. Please provide Handheld resolution/FPS and TV resolution/FPS, or mark an unsupported mode as Not Supported.`,
    });
    return issues;
  }

  if (record.informationStatus === "not_published" || record.informationStatus === "not_tested") {
    const missing: string[] = [];
    if (!record.unavailableReason) missing.push("unavailable_reason");
    if (!record.sourceName && !record.sourceUrl) missing.push("source_name or source_url");
    if (!record.verificationStatus) missing.push("verification_status");
    if (missing.length) {
      issues.push({
        key: "device_performance",
        severity: "error",
        message: `Performance information is marked ${record.informationStatus}, but the following fields are required: ${missing.join(", ")}.`,
      });
    }
    return issues;
  }

  const missing = [...modeMissing(record.handheld, "handheld"), ...modeMissing(record.tv, "tv")];
  if (missing.length) {
    issues.push({
      key: "device_performance",
      severity: "error",
      message: `Import validation error: ${requiredDevice.name} performance data is required. Missing: ${missing.join(", ")}. If a mode is not supported, mark it as Not Supported.`,
    });
  }

  return issues;
}

export function requiresPerformanceReview(product: Record_ | null | undefined): boolean {
  if (!product || typeof product !== "object") return false;
  return validateGameDevicePerformance(product).length > 0;
}

function modeSummary(label: string, mode?: DeviceModePerformance): string {
  if (!mode) return "";
  if (mode.supported === false) return `${label}: Not Supported`;
  const resolution = mode.outputResolution || mode.resolution;
  const parts = [resolution, mode.fps ? `${mode.fps}${/fps/i.test(mode.fps) ? "" : " FPS"}` : ""];
  if (mode.hdr) parts.push("HDR");
  if (mode.vrr) parts.push("VRR");
  return `${label}: ${parts.filter(Boolean).join(" / ")}`;
}

export function performanceSummary(record: DevicePerformance): string {
  return [modeSummary("Handheld", record.handheld), modeSummary("TV", record.tv)]
    .filter(Boolean)
    .join(" · ");
}

export function parseFps(value: unknown): number {
  const values =
    text(value)
      .match(/\d+(?:\.\d+)?/g)
      ?.map(Number)
      .filter(Number.isFinite) ?? [];
  return values.length ? Math.max(...values) : 0;
}

export function resolutionRank(value: unknown): number {
  const normalized = text(value).toLowerCase();
  if (/4k|3840\s*[x×]\s*2160|2160p/.test(normalized)) return 2160;
  if (/1440p|2560\s*[x×]\s*1440/.test(normalized)) return 1440;
  if (/1080p|1920\s*[x×]\s*1080/.test(normalized)) return 1080;
  if (/900p/.test(normalized)) return 900;
  if (/720p|1280\s*[x×]\s*720/.test(normalized)) return 720;
  const vertical = normalized.match(/(\d{3,4})p/);
  return vertical ? Number(vertical[1]) : 0;
}

export function performanceMatches(record: DevicePerformance, filters: readonly string[]): boolean {
  if (!filters.length) return true;
  const fpsValues = [
    record.handheld?.fps,
    record.handheld?.fpsMin,
    record.handheld?.fpsMax,
    record.tv?.fps,
    record.tv?.fpsMin,
    record.tv?.fpsMax,
    ...(record.modes || []).flatMap((mode) => [mode.handheldFps, mode.tvFps]),
  ].flatMap(
    (value) =>
      text(value)
        .match(/\d+(?:\.\d+)?/g)
        ?.map(Number) || [],
  );
  const resolutionValues = [
    record.handheld?.resolution,
    record.handheld?.renderingResolution,
    record.handheld?.outputResolution,
    record.tv?.resolution,
    record.tv?.renderingResolution,
    record.tv?.outputResolution,
    ...(record.modes || []).flatMap((mode) => [mode.handheldResolution, mode.tvResolution]),
  ]
    .map(resolutionRank)
    .filter(Boolean);
  const blob = JSON.stringify(record).toLowerCase();
  return filters.every((filter) => {
    switch (filter.toLowerCase()) {
      case "30":
      case "40":
      case "60":
      case "120":
        return fpsValues.includes(Number(filter));
      case "1080p":
        return resolutionValues.includes(1080);
      case "1440p":
        return resolutionValues.includes(1440);
      case "4k":
        return resolutionValues.includes(2160);
      case "hdr":
        return record.handheld?.hdr === true || record.tv?.hdr === true;
      case "vrr":
        return record.handheld?.vrr === true || record.tv?.vrr === true;
      case "handheld":
        return record.handheld?.supported !== false && Boolean(record.handheld);
      case "tv":
      case "tv mode":
        return record.tv?.supported !== false && Boolean(record.tv);
      case "ray-tracing":
      case "ray tracing":
        return record.rayTracing === true;
      default:
        return blob.includes(filter.toLowerCase());
    }
  });
}

/* -------------------------------------------------------------------------- */
/* One record per game, named by the platform                                 */
/* -------------------------------------------------------------------------- */

/**
 * The single device a game's platform names. A catalogue product is one SKU on
 * one console — a distinct Switch 1 edition is its own product — so its
 * performance section describes exactly one device. Backward compatibility of
 * a Switch title on Switch 2 is a compatibility note, never a second record.
 */
export const PLATFORM_DEVICE = {
  switch1: { slug: "nintendo-switch", name: "Nintendo Switch" },
  switch2: { slug: "nintendo-switch-2", name: "Nintendo Switch 2" },
} as const;

export type GamePlatformKey = keyof typeof PLATFORM_DEVICE;

/** `both` and every Switch 2 spelling lead with the newer console. */
export function resolveGamePlatformKey(platform: unknown): GamePlatformKey {
  const normalized = normalizePlatform(platform);
  return normalized === "switch2" || normalized === "both" ? "switch2" : "switch1";
}

/**
 * The hardware identity for a platform's device: the matching Hardware
 * product when the catalogue has one (matched by slug, id, then name), the
 * canonical slug/name otherwise — so the section renders and saves correctly
 * even before the hardware section is populated.
 */
export function resolvePlatformHardware(
  platformKey: GamePlatformKey,
  hardwareProducts: readonly Record_[] = [],
): { device: string; deviceSlug: string; hardwareId?: string; deviceModel?: string } {
  const target = PLATFORM_DEVICE[platformKey];
  const hardware = (hardwareProducts || []).find((item) => {
    if (!item || typeof item !== "object") return false;
    if (slugifyDevice(item["slug"]) === target.slug) return true;
    if (String(item["id"] ?? "") === target.slug) return true;
    return slugifyDevice(item["title"] ?? item["name"]) === target.slug;
  });
  return {
    device: text(hardware?.["title"] ?? hardware?.["name"]) || target.name,
    deviceSlug: target.slug,
    ...(hardware?.["id"] !== undefined && hardware?.["id"] !== null
      ? { hardwareId: String(hardware["id"]) }
      : {}),
    ...(text(hardware?.["model"] ?? hardware?.["modelNumber"])
      ? { deviceModel: text(hardware?.["model"] ?? hardware?.["modelNumber"]) }
      : {}),
  };
}

const matchesDeviceSlug = (record: DevicePerformance, slug: string): boolean =>
  record.deviceSlug === slug || slugifyDevice(record.device) === slug;

/**
 * Collapses a game's stored performance data to exactly one record, owned by
 * the platform's device.
 *
 * - Duplicates of the platform device merge together.
 * - Records for *other* devices are dropped, never blended in: their numbers
 *   describe different silicon, and copying them is how a Switch figure ends
 *   up published as Switch 2 performance. The one exception is a game whose
 *   only records carry a stale device label — that data was entered for this
 *   game, so the most complete record is kept and re-badged.
 * - A game with no data gets a fresh skeleton, so the editor always has the
 *   one record to fill and nothing to add or pick.
 *
 * Hardware capabilities are never read here; only the hardware identity is.
 */
export function normalizeGameDevicePerformance(
  product: Record_ | null | undefined,
  hardwareProducts: readonly Record_[] = [],
): DevicePerformance[] {
  const platformKey = resolveGamePlatformKey(product?.["platform"]);
  const identity = resolvePlatformHardware(platformKey, hardwareProducts);
  const records = dedupeDevicePerformance(getDevicePerformanceList(product ?? {}));

  const matching = records.filter((record) => matchesDeviceSlug(record, identity.deviceSlug));
  let base: DevicePerformance | undefined;
  if (matching.length > 0) {
    base = matching.reduce((merged, record) => mergeDevicePerformanceRecords(merged, record));
  } else if (records.length > 0) {
    const otherPlatformSlugs = Object.values(PLATFORM_DEVICE).map((device) => device.slug);
    const relabelable = records.filter(
      (record) => !otherPlatformSlugs.some((slug) => matchesDeviceSlug(record, slug)),
    );
    if (relabelable.length > 0) {
      base = relabelable.reduce((best, record) =>
        calculateRecordCompleteness(record) > calculateRecordCompleteness(best) ? record : best,
      );
    }
  }

  const record: DevicePerformance = {
    ...(base ?? {
      informationStatus: "available" as const,
      handheld: { supported: true },
      tv: { supported: true },
      modes: [],
    }),
    device: identity.device,
    deviceSlug: identity.deviceSlug,
    ...(identity.hardwareId ? { hardwareId: identity.hardwareId } : {}),
    ...(identity.deviceModel ? { deviceModel: identity.deviceModel } : {}),
  };
  if (!identity.hardwareId) delete record.hardwareId;
  if (!identity.deviceModel && base?.deviceModel === undefined) {
    delete record.deviceModel;
  }
  return [compact(record)];
}
