/**
 * Maps our own product record (as saved by the admin panel, see
 * `src/lib/hub-schema.ts` for the exact field keys) onto the reference Game
 * Hub model (`src/hub/types.ts`).
 */

import {
  lines,
  rows,
  youtubeEmbed,
  youtubeThumbnail,
  readOffers,
  type ListRow,
  str,
  slugify,
  num,
  bool,
  getTextValue,
} from "@/lib/hub";
import { resolveNintendoImage, resolveCaseSleeve } from "@/lib/nintendoImages";
import { buildFitFor, buildFeatures } from "./mappers";
import { toAmount, isVisibleToPublic } from "@/lib/purchasable";
import { gb } from "@/hub/utils/format";
import { getDevicePerformanceList } from "@/lib/devicePerformance";
import { getProductSlug } from "@/lib/productRouting";
import { resolveCategoryType } from "@/lib/productSection";
import { slugifyTitle, normalizeName } from "@/lib/gameData/identity";
import {
  resolveOptionStandardDescription,
  resolveTypeStandardDescription,
} from "@/lib/productOptionDescriptions";
import type {
  Game,
  GameImage,
  GameVideo,
  GameEdition,
  GameplayPillar,
  GameplayPillarId,
  StorySection,
  FeatureTag,
  PerformanceProfile,
  StorageInfo,
  LanguageSupport,
  MultiplayerInfo,
  Dlc,
  Guide,
  CompletionInfo,
  FaqItem,
  TimelineEvent,
  PatchNote,
  Soundtrack,
  GameSeries,
  SimilarGame,
  SimilarityKind,
  NintendoDetail,
  PlayMode,
  Switch2Enhancement,
  EditorVerdict,
  StoreOffer,
  Money,
  PlatformId,
  Fact,
} from "@/hub/types";

export function localizedValue(
  p: Record<string, unknown>,
  arKey: string,
  enKey: string,
  locale: "ar" | "en",
) {
  if (locale === "ar") {
    return str(p[arKey]) || str(p[enKey]);
  }
  return str(p[enKey]) || str(p[arKey]);
}

const hasNum = (v: unknown) => str(v) !== "" && Number.isFinite(toAmount(v)) && toAmount(v) !== 0;

const confirmed = <T>(value: T, source = "لوحة الإدارة"): Fact<T> => ({
  value,
  status: "confirmed",
  source,
});

function buildCore(p: Record<string, unknown>, locale: "ar" | "en") {
  const title = str(p["titleEn"]) || str(p["english_name"]) || str(p["title"]);

  /*
    The Arabic description had a spelling nobody read.

    The import template writes `description_ar=`, and the schema keeps that
    field under the snake_case target `description_ar`. Both `description` and
    `description_en` target `description`. So this chain — which only knew
    `descriptionAr` — never found the Arabic text, fell through to
    `description`, and rendered the *English* copy inside an Arabic page.

    Every spelling the catalogue actually contains is listed, Arabic first.
  */
  const desc =
    locale === "en"
      ? str(p["descriptionEn"]) || str(p["description_en"]) || str(p["description"])
      : str(p["descriptionAr"]) ||
        str(p["description_ar"]) ||
        str(p["description"]) ||
        str(p["descriptionEn"]);

  const tag =
    locale === "en"
      ? str(p["taglineEn"]) || str(p["tagline_en"]) || str(p["tagline"])
      : str(p["taglineAr"]) || str(p["tagline_ar"]) || str(p["tagline"]) || str(p["taglineEn"]);

  return {
    title: title || "Product",
    description: desc || undefined,
    tagline: tag || undefined,
  };
}

function buildMedia(p: Record<string, unknown>, locale: "ar" | "en") {
  // The hub used to read `coverImage → image → cartridgeImage`, while the home
  // strips read the same three fields in the opposite order — so one product
  // legitimately showed two different covers. Both now ask the resolver.
  const front = resolveNintendoImage(p, "front-box");
  const coverUrl = front.isPlaceholder ? undefined : front.url;
  // The detail page's primary cover is its own field. It is what the flat 2D
  // case shows while the 3D one loads, and on a device that cannot run WebGL.
  const detail = resolveNintendoImage(p, "detail-cover");
  const banner = resolveNintendoImage(p, "banner");
  const keyArtUrl = banner.isPlaceholder ? undefined : banner.url;
  const texture = resolveNintendoImage(p, "3d-texture");

  const productTitleEng = str(p["titleEn"]) || str(p["english_name"]) || str(p["title"]);

  const galleryRows = rows(p["galleryImages"]);
  const legacyGallery = Array.isArray(p["gallery"])
    ? (p["gallery"] as unknown[]).map(str).filter(Boolean)
    : [];
  const images: GameImage[] = [
    ...rows(p["galleryImages"]).map((row, i) => ({
      id: `img-${i}`,
      url: str(row["url"]),
      alt: localizedValue(row, "alt", "altEn", locale) || productTitleEng || "",
    })),
    ...legacyGallery.map((url, i) => ({
      id: `legacy-img-${i}`,
      url,
      alt: productTitleEng || "",
    })),
  ].filter((img) => img.url);

  const videoRows = rows(p["videos"]);
  /*
    The import schema stores `trailer_url=` under `youtubeTrailer` (and the
    admin form edits that same field); `trailerUrl` only ever existed on legacy
    records. Reading just the legacy name left the trailer card empty on every
    imported game while the URL sat in the document.
  */
  const trailerUrl =
    str(p["trailerUrl"]) || str(p["youtubeTrailer"]) || str(p["trailer_url"]);
  const videos: GameVideo[] = [
    ...(trailerUrl
      ? [
          {
            id: "trailer",
            kind: "trailer" as const,
            title: locale === "en" ? "Official Trailer" : "الإعلان الرسمي",
            embedUrl: youtubeEmbed(trailerUrl) ?? trailerUrl,
            // Without a poster the card paints an empty gradient rectangle at
            // the size it reserved. See `youtubeThumbnail`.
            ...(youtubeThumbnail(trailerUrl) ? { thumbnailUrl: youtubeThumbnail(trailerUrl)! } : {}),
          },
        ]
      : []),
    ...videoRows.reduce<GameVideo[]>((acc, row, i) => {
      const embedUrl = youtubeEmbed(row["url"]);
      if (!embedUrl) return acc;
      const poster = str(row["thumbnailUrl"]) || youtubeThumbnail(row["url"]);
      acc.push({
        id: `video-${i}`,
        kind: "gameplay" as const,
        title:
          localizedValue(row, "title", "titleEn", locale) || (locale === "en" ? "Video" : "فيديو"),
        embedUrl,
        ...(poster ? { thumbnailUrl: poster } : {}),
      });
      return acc;
    }, []),
  ];

  const caseSleeve = resolveCaseSleeve(p);

  return {
    coverUrl,
    detailCoverUrl: detail.isPlaceholder ? undefined : detail.url,
    keyArtUrl,
    caseSleeve,
    /** Highest-resolution front cover available; what the 3D sleeve should sample. */
    coverTextureUrl: texture.isPlaceholder ? undefined : texture.url,
    /** Stored crop for `coverUrl`, when the catalogue carries one. */
    coverTrim: front.trim,
    images: images.length ? images : undefined,
    videos: videos.length ? videos : undefined,
  };
}

function buildGenres(p: Record<string, unknown>): string[] | undefined {
  const genres = Array.isArray(p["genres"])
    ? (p["genres"] as unknown[])
        .map((r) =>
          getTextValue(typeof r === "object" && r !== null && "value" in r ? (r as any).value : r),
        )
        .filter(Boolean)
    : lines(p["genre"]);
  return genres.length ? genres : undefined;
}

function buildAgeRating(p: Record<string, unknown>): Game["ageRating"] | undefined {
  const raw = str(p["ageRating"]);
  if (!raw) return undefined;

  // Catalogue entries usually already name the system ("ESRB E10+ ..."), and
  // prefixing another one produced "ESRB ESRB E10+" on the page. Take the
  // system from the value when it carries one.
  const match = /^\s*(ESRB|PEGI|CERO|USK)\b[\s:.-]*/i.exec(raw);
  if (match) {
    const system = match[1]!.toUpperCase() as NonNullable<Game["ageRating"]>["system"];
    const label = raw.slice(match[0].length).trim();
    return { system, label: label || raw.trim() };
  }
  return { system: "ESRB", label: raw };
}

function buildNintendo(
  p: Record<string, unknown>,
  locale: "ar" | "en",
): NintendoDetail | undefined {
  const platform = str(p["platform"]);
  const switch2Enhanced = bool(p["switch2Enhanced"]);
  const isSwitch2Only = platform === "switch2" && !switch2Enhanced;

  const runsOn: NintendoDetail["runsOn"] = isSwitch2Only ? ["switch2"] : ["switch", "switch2"];

  const playModesText = str(p["nintendoPlayModes"]);
  const playModes: PlayMode[] | undefined = playModesText
    ? (["tv", "handheld", "tabletop"] as PlayMode[]).filter((mode) => {
        const kw: Record<PlayMode, RegExp> = {
          tv: /تلفاز|tv|dock/i,
          handheld: /محمول|handheld/i,
          tabletop: /طاولة|tabletop/i,
        };
        return kw[mode].test(playModesText);
      })
    : undefined;

  const features: NintendoDetail["features"] = [];
  if ("nintendoCloudSaves" in p) {
    features.push({ id: "cloud-saves", supported: bool(p["nintendoCloudSaves"]) });
  }

  const enhancementLines = rows(p["switch2Features"])
    .map((r) => {
      const v = locale === "en" && r["valueEn"] ? r["valueEn"] : r["value"];
      return getTextValue(v !== undefined ? v : r);
    })
    .filter(Boolean);
  const enhancementMatchers: Array<{ id: Switch2Enhancement["id"]; re: RegExp }> = [
    { id: "resolution", re: /دقة|resolution|4k|1080|1440/i },
    { id: "framerate", re: /إطار|fps|frame ?rate|60|120/i },
    { id: "hdr", re: /hdr/i },
    { id: "loading", re: /تحميل|loading/i },
    { id: "textures", re: /نسيج|texture/i },
    { id: "ray-tracing", re: /ray.?tracing|إضاءة/i },
    { id: "mouse-controls", re: /ماوس|mouse/i },
    { id: "gamechat", re: /gamechat|دردشة/i },
  ];
  const enhancements: Switch2Enhancement[] = enhancementLines.map((label, i) => {
    const match = enhancementMatchers.find((m) => m.re.test(label));
    return { id: match?.id ?? "effects", label };
  });

  const detail: NintendoDetail = {
    runsOn,
    ...(isSwitch2Only ? { switch2Only: true } : {}),
    ...(switch2Enhanced
      ? { switch2Enhanced: { available: true, ...(enhancements.length ? { enhancements } : {}) } }
      : {}),
    ...(playModes && playModes.length ? { playModes } : {}),
    ...(features.length ? { features } : {}),
    ...("nintendoGameKeyCard" in p
      ? { gameKeyCard: confirmed(bool(p["nintendoGameKeyCard"])) }
      : {}),
    ...("nintendoPhysicalNeedsDownload" in p
      ? { physicalRequiresDownload: confirmed(bool(p["nintendoPhysicalNeedsDownload"])) }
      : {}),
    ...("nintendoOnlineRequired" in p
      ? { switchOnline: { requiredForOnlinePlay: confirmed(bool(p["nintendoOnlineRequired"])) } }
      : {}),
  };

  const hasAnyData =
    detail.switch2Only ||
    detail.switch2Enhanced ||
    detail.playModes ||
    detail.features?.length ||
    detail.gameKeyCard ||
    detail.physicalRequiresDownload ||
    detail.switchOnline;
  return hasAnyData ? detail : undefined;
}

function buildPerformance(
  p: Record<string, unknown>,
  platform: PlatformId,
  _locale: "ar" | "en",
): PerformanceProfile[] | undefined {
  const records = getDevicePerformanceList(p);
  if (!records.length) return undefined;

  return records.map((record) => {
    const status =
      record.verificationStatus === "technical_analysis"
        ? "measured"
        : record.verificationStatus === "unverified"
          ? "unconfirmed"
          : "confirmed";
    const source = record.sourceName || record.sourceUrl || "Game performance record";
    const fact = <T>(value: T): Fact<T> => ({
      value,
      status,
      source,
      ...(record.verifiedAt ? { capturedAt: record.verifiedAt } : {}),
    });
    const mapMode = (
      mode: "handheld" | "tv",
      values: typeof record.handheld,
    ): NonNullable<PerformanceProfile["modes"]>[number] | undefined => {
      if (!values) return undefined;
      const resolution = values.outputResolution || values.resolution;
      return {
        mode,
        ...(values.supported !== undefined ? { supported: values.supported } : {}),
        ...(resolution ? { resolution: fact(resolution) } : {}),
        ...(values.renderingResolution
          ? { renderingResolution: fact(values.renderingResolution) }
          : {}),
        ...(values.outputResolution ? { outputResolution: fact(values.outputResolution) } : {}),
        ...(values.fps ? { frameRate: fact(values.fps) } : {}),
        ...(values.fpsMin ? { frameRateMin: fact(values.fpsMin) } : {}),
        ...(values.fpsMax ? { frameRateMax: fact(values.fpsMax) } : {}),
        ...(values.refreshRate ? { refreshRate: fact(values.refreshRate) } : {}),
        ...(values.hdr !== undefined ? { hdr: fact(values.hdr) } : {}),
        ...(values.vrr !== undefined ? { vrr: fact(values.vrr) } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      };
    };
    const modes = [mapMode("handheld", record.handheld), mapMode("tv", record.tv)].filter(
      Boolean,
    ) as NonNullable<PerformanceProfile["modes"]>;
    const mappedPlatform: PlatformId =
      record.deviceSlug === "nintendo-switch-2"
        ? "switch2"
        : record.deviceSlug === "nintendo-switch"
          ? "switch"
          : platform;

    return {
      platform: mappedPlatform,
      deviceName: record.device,
      deviceSlug: record.deviceSlug,
      ...(record.deviceModel ? { deviceModel: record.deviceModel } : {}),
      ...(record.hardwareId ? { hardwareId: record.hardwareId } : {}),
      ...(record.informationStatus ? { informationStatus: record.informationStatus } : {}),
      ...(record.unavailableReason ? { unavailableReason: record.unavailableReason } : {}),
      ...(modes.length ? { modes } : {}),
      ...(record.modes?.length ? { performanceModes: record.modes } : {}),
      ...(record.loadingTime ? { loadingTime: fact(record.loadingTime) } : {}),
      ...(record.handheld?.hdr !== undefined || record.tv?.hdr !== undefined
        ? { hdr: fact(record.handheld?.hdr === true || record.tv?.hdr === true) }
        : {}),
      ...(record.upscaling ? { upscaling: record.upscaling } : {}),
      ...(record.rayTracing !== undefined ? { rayTracing: record.rayTracing } : {}),
      ...(record.rayTracingMode ? { rayTracingMode: record.rayTracingMode } : {}),
      ...(record.gameVersion ? { gameVersion: record.gameVersion } : {}),
      ...(record.patchVersion ? { patchVersion: record.patchVersion } : {}),
      ...(record.testedDate ? { testedDate: record.testedDate } : {}),
      ...(record.sourceName ? { sourceName: record.sourceName } : {}),
      ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {}),
      ...(record.verifiedAt ? { verifiedAt: record.verifiedAt } : {}),
      ...(record.verificationStatus ? { verificationStatus: record.verificationStatus } : {}),
      ...(record.performanceNotes ? { notes: record.performanceNotes } : {}),
    };
  });
}

function buildStorage(p: Record<string, unknown>): StorageInfo | undefined {
  const downloadGb = num(p["downloadSizeGb"]);
  const requiredGb = num(p["requiredSpaceGb"]);
  const microSdRecommended = bool(p["microSdRecommended"]);
  if (!downloadGb && !requiredGb && !("microSdRecommended" in p)) return undefined;
  return {
    ...(downloadGb ? { downloadSizeBytes: confirmed(gb(downloadGb)) } : {}),
    ...(requiredGb ? { requiredSpaceBytes: confirmed(gb(requiredGb)) } : {}),
    ...("microSdRecommended" in p ? { microSdRecommended } : {}),
  };
}

/*
  A language *name*, not a sentence about languages. Templates that had nothing
  to state wrote a referral ("see the official product page…") into the same
  field, and rendering that as a supported language is worse than an empty
  section. Real names — "Traditional Chinese (Taiwan region)" included — fit
  under the cap and never use referral vocabulary.
*/
const REFERRAL_WORDS =
  /\b(see|varies|vary|check|refer|according|official|page|listing|information|details|availability|supported)\b/i;
const isLanguageName = (value: string) =>
  value.length > 0 && value.length <= 48 && !REFERRAL_WORDS.test(value);

function buildLanguages(p: Record<string, unknown>): LanguageSupport[] | undefined {
  const splitNames = (value: unknown) =>
    lines(value)
      .flatMap((l) => l.split(","))
      .map((s) => s.trim())
      .filter(isLanguageName);

  const audioNames = splitNames(p["languagesAudio"]);
  const textNames = splitNames(p["languagesText"]);
  /*
    The free-text official list (`supported_languages_raw`). When the per-channel
    fields are empty this is everything the catalogue knows, and it used to be
    ignored — so the page said nothing at all. A plain supported-language list
    means the game's interface ships in it.
  */
  const rawNames =
    audioNames.length || textNames.length
      ? []
      : splitNames(p["supportedLanguages"] ?? p["supported_languages_details"]);
  if (!audioNames.length && !textNames.length && !rawNames.length) return undefined;

  const byName = new Map<string, LanguageSupport>();
  const upsert = (name: string, channel: LanguageSupport["channels"][number]) => {
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      if (!existing.channels.includes(channel)) existing.channels.push(channel);
    } else {
      byName.set(key, { code: slugify(name).slice(0, 8), name, channels: [channel] });
    }
  };
  audioNames.forEach((n) => upsert(n, "audio"));
  textNames.forEach((n) => upsert(n, "subtitles"));
  rawNames.forEach((n) => upsert(n, "interface"));
  return Array.from(byName.values());
}

function parseRange(text: string): { min: number; max: number } | undefined {
  const m = /(\d+)\s*[-–]\s*(\d+)/.exec(text);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const single = /(\d+)/.exec(text);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return undefined;
}

/** true/false written in the field, as opposed to a legacy player count. */
function flag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const text = str(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
}

function buildMultiplayer(p: Record<string, unknown>): MultiplayerInfo | undefined {
  /*
    `mpLocalPlayers` / `mpOnlinePlayers` are flags: does this game support local
    play, and online play. Products saved while they briefly held a player count
    ("1-4") still parse as a range, so nothing already in the catalogue loses
    its numbers; the player count for new imports lives in `numberOfPlayers`.
  */
  const localFlag = flag(p["mpLocalPlayers"]);
  const onlineFlag = flag(p["mpOnlinePlayers"]);
  const localPlayers = localFlag === undefined ? parseRange(str(p["mpLocalPlayers"])) : undefined;
  const onlinePlayers =
    onlineFlag === undefined ? parseRange(str(p["mpOnlinePlayers"])) : undefined;

  const flagsPresent = ["mpCoop", "mpCompetitive", "mpSplitScreen", "mpLocalWireless"].some(
    (k) => k in p,
  );
  if (
    !localPlayers &&
    !onlinePlayers &&
    localFlag === undefined &&
    onlineFlag === undefined &&
    !flagsPresent
  ) {
    return undefined;
  }
  return {
    ...(localPlayers ? { localPlayers } : {}),
    ...(onlinePlayers ? { onlinePlayers, onlineMultiplayer: true } : {}),
    ...(localFlag === undefined ? {} : { localMultiplayer: localFlag }),
    ...(onlineFlag === undefined ? {} : { onlineMultiplayer: onlineFlag }),
    ...("mpCoop" in p ? { coop: bool(p["mpCoop"]) } : {}),
    ...("mpCompetitive" in p ? { competitive: bool(p["mpCompetitive"]) } : {}),
    ...("mpSplitScreen" in p ? { splitScreen: bool(p["mpSplitScreen"]) } : {}),
    ...("mpLocalWireless" in p ? { localWireless: bool(p["mpLocalWireless"]) } : {}),
  };
}

const money = (amount: number): Money => ({ amount, currency: "IQD" });

function buildEditions(p: Record<string, unknown>, locale: "ar" | "en"): GameEdition[] | undefined {
  const rawList =
    rows(p["editions"]).length > 0
      ? rows(p["editions"])
      : rows(p["types"]).length > 0
        ? rows(p["types"])
        : rows(p["variants"]);
  if (!rawList.length) return undefined;
  return rawList.map((row, i) => {
    const rawContents = rows(row["contents"]);
    const rawDesc = localizedValue(row, "description", "descriptionEn", locale);
    const desc =
      locale === "ar"
        ? resolveTypeStandardDescription(row["name"] || row["id"], rawDesc) || rawDesc
        : rawDesc;

    const contentsList =
      rawContents.length > 0
        ? rawContents.map((item, j) => ({
            id: `content-${i}-${j}`,
            label: localizedValue(item, "label", "labelEn", locale) || str(item),
            included: true,
          }))
        : desc
          ? [{ id: `content-${i}-0`, label: desc, included: true }]
          : [];

    const name =
      localizedValue(row, "name", "nameEn", locale) ||
      (locale === "en" ? `Edition ${i + 1}` : `نسخة ${i + 1}`);

    return {
      id: str(row["id"]) || `edition-${i}`,
      name,
      tier: "standard" as const,
      contents: contentsList,
      ...(hasNum(row["price"]) ? { msrp: money(num(row["price"])) } : {}),
      ...(str(row["coverUrl"] || row["image"])
        ? { coverUrl: str(row["coverUrl"] || row["image"]) }
        : {}),
    };
  });
}

const PILLAR_MATCHERS: Array<{ id: GameplayPillarId; re: RegExp }> = [
  { id: "combat", re: /قتال|combat|battle/i },
  { id: "exploration", re: /استكشاف|explor/i },
  { id: "story", re: /قصة|story|narrative/i },
  { id: "world", re: /عالم|world/i },
  { id: "weapons", re: /سلاح|weapon/i },
  { id: "abilities", re: /قدرات|ability|abilities|skill/i },
  { id: "enemies", re: /أعداء|enemy|enemies/i },
  { id: "bosses", re: /زعيم|boss/i },
  { id: "customization", re: /تخصيص|custom/i },
  { id: "multiplayer", re: /جماعي|multiplayer/i },
  { id: "coop", re: /تعاون|co-?op/i },
  { id: "crafting", re: /صناعة|craft/i },
  { id: "progression", re: /تقدم|progress|level/i },
];

function buildGameplayPillars(
  p: Record<string, unknown>,
  locale: "ar" | "en",
): GameplayPillar[] | undefined {
  const list = rows(p["gameplayPillars"]);
  if (!list.length) return undefined;
  return list.map((row, i) => {
    const title =
      localizedValue(row, "title", "titleEn", locale) ||
      (locale === "en" ? `Pillar ${i + 1}` : `ركيزة ${i + 1}`);
    const match = PILLAR_MATCHERS.find((m) => m.re.test(title));
    return {
      id: match?.id ?? "exploration",
      title,
      description: localizedValue(row, "description", "descriptionEn", locale),
    };
  });
}

function buildStory(p: Record<string, unknown>, locale: "ar" | "en"): StorySection[] | undefined {
  const worldSummary = localizedValue(p, "worldSummary", "worldSummaryEn", locale);
  const chapters = rows(p["storyChapters"]);
  const sections: StorySection[] = [
    ...(worldSummary
      ? [
          {
            id: "world-summary",
            title: locale === "en" ? "Game World" : "عالم اللعبة",
            body: worldSummary,
          },
        ]
      : []),
    ...chapters.map((row, i) => ({
      id: `story-${i}`,
      title:
        localizedValue(row, "title", "titleEn", locale) ||
        (locale === "en" ? `Chapter ${i + 1}` : `فصل ${i + 1}`),
      body: localizedValue(row, "body", "bodyEn", locale),
      ...(str(row["imageUrl"]) ? { imageId: str(row["imageUrl"]) } : {}),
    })),
  ];
  return sections.length ? sections : undefined;
}

function buildDlc(p: Record<string, unknown>, locale: "ar" | "en"): Dlc[] | undefined {
  const list = rows(p["dlc"] || p["dlcs"]);
  if (!list.length) return undefined;
  const filtered = list
    .filter((row) => {
      const name =
        localizedValue(row, "name", "nameEn", locale) ||
        localizedValue(row, "title", "titleEn", locale);
      return Boolean(name && name.trim());
    })
    .map((row, i) => {
      const name =
        localizedValue(row, "name", "nameEn", locale) ||
        localizedValue(row, "title", "titleEn", locale) ||
        (locale === "en" ? `DLC ${i + 1}` : `إضافة ${i + 1}`);
      const cover = str(row["coverUrl"] || row["image"] || row["cartridgeImage"]);
      const desc = localizedValue(row, "description", "descriptionEn", locale);
      return {
        id: str(row["id"]) || `dlc-${i}`,
        name,
        ...(cover ? { coverUrl: cover } : {}),
        ...(desc ? { description: desc } : {}),
      };
    });
  return filtered.length ? filtered : undefined;
}

function buildGuides(p: Record<string, unknown>, locale: "ar" | "en"): Guide[] | undefined {
  const list = rows(p["guides"]);
  if (!list.length) return undefined;
  return list.map((row, i) => ({
    slug: slugify(str(row["title"]) || `guide-${i}`),
    title:
      localizedValue(row, "title", "titleEn", locale) ||
      (locale === "en" ? `Guide ${i + 1}` : `دليل ${i + 1}`),
    category: "tips" as const,
    summary: localizedValue(row, "summary", "summaryEn", locale),
    ...(str(row["url"]) ? { sections: [{ body: str(row["url"]) }] } : {}),
  }));
}

function buildCompletion(p: Record<string, unknown>): CompletionInfo | undefined {
  const main = num(p["completionMain"]);
  const extras = num(p["completionExtras"]);
  const all = num(p["completionAll"]);
  if (!main && !extras && !all) return undefined;
  return {
    ...(main ? { mainStoryHours: { min: main, max: main } } : {}),
    ...(extras ? { mainPlusExtrasHours: { min: extras, max: extras } } : {}),
    ...(all ? { hundredPercentHours: { min: all, max: all } } : {}),
  };
}

function buildFaq(p: Record<string, unknown>, locale: "ar" | "en"): FaqItem[] | undefined {
  const list = rows(p["faq"]);
  if (!list.length) return undefined;
  return list.map((row, i) => ({
    id: `faq-${i}`,
    question: localizedValue(row, "q", "qEn", locale),
    answer: localizedValue(row, "a", "aEn", locale),
  }));
}

function normalizeTimelineItem(
  raw: unknown,
  index: number,
  locale: "ar" | "en",
  defaultKind: TimelineEvent["kind"] = "update",
): TimelineEvent | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    if (text.startsWith("{") && text.endsWith("}")) {
      try {
        const parsed = JSON.parse(text);
        return normalizeTimelineItem(parsed, index, locale, defaultKind);
      } catch {
        // Continue
      }
    }
    const match = text.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4})\s*[:\-\u2013]\s*(.*)$/);
    if (match && match[1] && match[2]) {
      const date = match[1].replace(/\./g, "-");
      const title = match[2].trim() || (locale === "en" ? "Event" : "حدث");
      return {
        id: `timeline-${index}`,
        date,
        kind: inferTimelineKind(title, defaultKind),
        title,
      };
    }
    return {
      id: `timeline-${index}`,
      date: "",
      kind: inferTimelineKind(text, defaultKind),
      title: text,
    };
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const date = str(
      obj["date"] ||
        obj["releaseDate"] ||
        obj["release_date"] ||
        obj["time"] ||
        obj["timestamp"] ||
        obj["createdAt"],
    );
    const title =
      localizedValue(obj, "title", "titleEn", locale) ||
      localizedValue(obj, "name", "nameEn", locale) ||
      str(obj["version"] ? `Version ${obj["version"]}` : "") ||
      (locale === "en" ? "Event" : "حدث");
    const detail =
      localizedValue(obj, "body", "bodyEn", locale) ||
      localizedValue(obj, "details", "detailsEn", locale) ||
      localizedValue(obj, "description", "descriptionEn", locale) ||
      (Array.isArray(obj["changes"]) ? (obj["changes"] as string[]).join("\n") : undefined);
    const kindRaw = str(obj["kind"] || obj["type"] || obj["eventType"] || obj["event_type"]);
    const kind = inferTimelineKind(kindRaw || title || "", defaultKind);
    const version = str(obj["version"]) || undefined;
    const sourceUrl =
      str(obj["sourceUrl"] || obj["url"] || obj["link"] || obj["source"]) || undefined;
    const videoId = str(obj["videoId"] || obj["youtubeId"]) || undefined;

    return {
      id: str(obj["id"]) || `timeline-${index}`,
      date,
      kind,
      title,
      ...(detail ? { detail } : {}),
      ...(version ? { version } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(videoId ? { videoId } : {}),
    };
  }

  return null;
}

function inferTimelineKind(
  strVal: string,
  fallback: TimelineEvent["kind"] = "update",
): TimelineEvent["kind"] {
  const s = strVal.toLowerCase();
  if (
    s.includes("announce") ||
    s.includes("إعلان") ||
    s.includes("اعلان") ||
    s.includes("كشف")
  )
    return "announcement";
  if (s.includes("trailer") || s.includes("تريلر") || s.includes("عرض")) return "trailer";
  if (s.includes("demo") || s.includes("تجريبي") || s.includes("نسخة تجريبية")) return "demo";
  if (
    s.includes("launch") ||
    s.includes("release") ||
    s.includes("إصدار") ||
    s.includes("اصدار") ||
    s.includes("إطلاق")
  )
    return "release";
  if (s.includes("expansion") || s.includes("توسعة")) return "expansion";
  if (s.includes("dlc") || s.includes("إضافة") || s.includes("اضافة")) return "dlc";
  if (
    s.includes("patch") ||
    s.includes("update") ||
    s.includes("تحديث") ||
    s.includes("تصحيح") ||
    s.includes("ver") ||
    s.startsWith("v")
  )
    return "update";
  return fallback;
}

function buildTimeline(
  p: Record<string, unknown>,
  locale: "ar" | "en",
): TimelineEvent[] | undefined {
  const events: TimelineEvent[] = [];
  const seenKeys = new Set<string>();

  const addEvent = (event: TimelineEvent | null) => {
    if (!event || !event.title) return;
    const key = `${event.date}_${event.title}`.toLowerCase();
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    events.push(event);
  };

  // 1. Explicit timeline field
  const explicitTimeline = rows(p["timeline"]);
  explicitTimeline.forEach((item) => {
    addEvent(normalizeTimelineItem(item, events.length, locale, "update"));
  });

  // 2. Events / releaseTimeline / milestones / announcements
  const altEvents = rows(
    p["events"] ||
      p["releaseTimeline"] ||
      p["release_timeline"] ||
      p["milestones"] ||
      p["announcements"],
  );
  altEvents.forEach((item) => {
    addEvent(normalizeTimelineItem(item, events.length, locale, "announcement"));
  });

  // 3. Patch notes / updates
  const patchNotes = rows(p["patchNotes"] || p["updates"] || p["patches"]);
  patchNotes.forEach((item) => {
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const version = str(row["version"]);
      const date = str(row["date"]);
      const body =
        localizedValue(row, "body", "bodyEn", locale) ||
        localizedValue(row, "changes", "changesEn", locale);
      if (version || date || body) {
        addEvent({
          id: `patch-${events.length}`,
          date: date || "",
          kind: "update",
          title: version
            ? locale === "en"
              ? `Update ${version}`
              : `تحديث ${version}`
            : locale === "en"
              ? "Game Update"
              : "تحديث اللعبة",
          ...(body ? { detail: body } : {}),
          ...(version ? { version } : {}),
        });
      }
    }
  });

  // 4. DLC items as timeline milestones
  const dlcList = rows(p["dlc"] || p["dlcs"] || p["DLC"]);
  dlcList.forEach((item) => {
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const title =
        localizedValue(row, "name", "nameEn", locale) ||
        localizedValue(row, "title", "titleEn", locale);
      const date = str(row["releaseDate"] || row["date"]);
      const desc = localizedValue(row, "description", "descriptionEn", locale);
      if (title && date) {
        addEvent({
          id: `dlc-${events.length}`,
          date,
          kind: "dlc",
          title: locale === "en" ? `DLC: ${title}` : `إضافة: ${title}`,
          ...(desc ? { detail: desc } : {}),
        });
      }
    }
  });

  // 5. Official release date event if not already present
  const releaseDate = str(p["releaseDate"] || p["release_date"]);
  if (releaseDate && !events.some((e) => e.kind === "release")) {
    const gameTitle = str(p["titleEn"] || p["title"] || "Game");
    addEvent({
      id: `release-${events.length}`,
      date: releaseDate,
      kind: "release",
      title: locale === "en" ? `Official Release: ${gameTitle}` : `الإطلاق الرسمي: ${gameTitle}`,
    });
  }

  if (!events.length) return undefined;

  // Sort chronologically (newest first)
  return events.sort((a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    const validA = Number.isFinite(timeA) && timeA > 0;
    const validB = Number.isFinite(timeB) && timeB > 0;
    if (validA && validB) return timeB - timeA;
    if (validA) return -1;
    if (validB) return 1;
    return 0;
  });
}

function buildSimilar(
  p: Record<string, unknown>,
  allProducts: Array<Record<string, unknown>> | undefined,
  locale: "ar" | "en",
): SimilarGame[] | undefined {
  const currentId = String(p["id"] ?? "");
  const currentSlug = getProductSlug(p);
  const currentTitleEn = str(p["titleEn"] || p["english_name"] || p["title"]);
  const currentSlugTitle = slugifyTitle(currentTitleEn);
  const currentSeries = str(p["seriesName"] || p["series"]);
  const currentDeveloper = str(p["developer"] || p["studioName"] || p["developerEn"]);
  const currentPublisher = str(p["publisher"] || p["publisherEn"]);
  const currentGenres = buildGenres(p) ?? [];

  // Eligible products in catalog: must be active Nintendo switch games, not the current game
  const catalog = (Array.isArray(allProducts) ? allProducts : []).filter((cand) => {
    if (!cand || typeof cand !== "object") return false;
    const candId = String(cand["id"] ?? "");
    if (!candId || candId === currentId) return false;
    const candSlug = getProductSlug(cand);
    if (candSlug && candSlug === currentSlug) return false;
    if (
      currentSlugTitle &&
      slugifyTitle(String(cand["titleEn"] || cand["english_name"] || cand["title"] || "")) ===
        currentSlugTitle
    )
      return false;

    // Check if visible to public (not hidden, not draft, not deleted)
    if (!isVisibleToPublic(cand)) return false;

    // Check category: must be a game
    const catId = cand["category"] || cand["categoryId"];
    const catTitle = cand["categoryTitle"] || cand["category_title"];
    const catType = resolveCategoryType(
      String(catId || ""),
      String(catTitle || ""),
      str(cand["kind"]),
      str(cand["schemaId"]),
    );
    return catType === "game";
  });

  const similarList: SimilarGame[] = [];
  const addedIds = new Set<string>();

  const createSimilarGameFromProduct = (
    cand: Record<string, unknown>,
    reasons: Array<{ kind: SimilarityKind; text: string }>,
    matchScore = 0.95,
  ): SimilarGame => {
    const slug = str(cand["id"]) || getProductSlug(cand);
    const title =
      localizedValue(cand, "title", "titleEn", locale) ||
      str(cand["titleEn"]) ||
      str(cand["title"]) ||
      "Game";
    const front = resolveNintendoImage(cand, "front-box");
    const coverUrl = !front.isPlaceholder
      ? front.url
      : str(cand["image"]) || str(cand["coverImage"]) || undefined;
    const priceAmount = toAmount(cand["price"]);
    const candPlatform: PlatformId = str(cand["platform"]) === "switch2" ? "switch2" : "switch";
    const platforms: PlatformId[] = bool(cand["switch2Enhanced"])
      ? ["switch", "switch2"]
      : [candPlatform];

    return {
      slug,
      title,
      ...(coverUrl ? { coverUrl } : {}),
      ...(priceAmount > 0 ? { price: money(priceAmount) } : {}),
      rating: num(cand["metacriticRating"]) || num(cand["playerScore"]) || undefined,
      platforms,
      reasons: reasons.length
        ? reasons
        : [
            {
              kind: "genre",
              text: locale === "en" ? "Similar Nintendo Game" : "لعبة نينتندو مشابهة",
            },
          ],
      matchScore: Math.min(0.99, Math.max(0.6, matchScore)),
    };
  };

  // Helper to find in catalog
  const findInCatalog = (ref: unknown): Record<string, unknown> | undefined => {
    if (!ref) return undefined;
    const refStr =
      typeof ref === "string"
        ? ref.trim()
        : typeof ref === "object" && ref !== null
          ? str((ref as any).id || (ref as any).slug || (ref as any).title)
          : "";
    if (!refStr) return undefined;
    const refLower = refStr.toLowerCase();
    const refSlug = slugifyTitle(refStr);
    const refNorm = normalizeName(refStr);

    return catalog.find((cand) => {
      if (String(cand["id"]).toLowerCase() === refLower) return true;
      if (cand["slug"] && String(cand["slug"]).toLowerCase() === refLower) return true;
      const cTitle = str(cand["titleEn"] || cand["english_name"] || cand["title"]);
      if (slugifyTitle(cTitle) === refSlug) return true;
      if (normalizeName(cTitle) === refNorm) return true;
      return false;
    });
  };

  // 1. Explicit similar_games from product record
  const explicitRaw = rows(
    p["similar_games"] ||
      p["similarGames"] ||
      p["similarIds"] ||
      p["similar_ids"] ||
      p["similarGamesInfo"] ||
      p["similar"] ||
      p["related_games"] ||
      p["relatedGames"],
  );

  for (const item of explicitRaw) {
    if (!item) continue;
    const matched = findInCatalog(item);
    if (matched) {
      const matchedId = String(matched["id"]);
      if (addedIds.has(matchedId)) continue;
      addedIds.add(matchedId);

      const itemObj =
        typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
      const customReason = str(
        itemObj["reason"] || itemObj["description"] || itemObj["matchReason"],
      );
      const customScore =
        num(itemObj["score"] || itemObj["matchScore"] || itemObj["similarityScore"]) || 0.95;

      const reasons: Array<{ kind: SimilarityKind; text: string }> = [];
      if (customReason) {
        reasons.push({ kind: "gameplay", text: customReason });
      } else {
        const candGenres = Array.isArray(matched["genres"])
          ? (matched["genres"] as string[])
          : [];
        const sharedGenre = currentGenres.find((g) => candGenres.includes(g));
        if (currentSeries && str(matched["seriesName"] || matched["series"]) === currentSeries) {
          reasons.push({
            kind: "story",
            text:
              locale === "en"
                ? `Same series: ${currentSeries}`
                : `من نفس السلسلة: ${currentSeries}`,
          });
        } else if (sharedGenre) {
          reasons.push({
            kind: "genre",
            text: locale === "en" ? `Similar genre: ${sharedGenre}` : `نوع مشابه: ${sharedGenre}`,
          });
        } else if (
          currentDeveloper &&
          str(matched["developer"] || matched["studioName"]) === currentDeveloper
        ) {
          reasons.push({
            kind: "gameplay",
            text:
              locale === "en"
                ? `From the same developer: ${currentDeveloper}`
                : `من نفس المطور: ${currentDeveloper}`,
          });
        } else {
          reasons.push({
            kind: "nintendo",
            text:
              locale === "en"
                ? "Recommended Nintendo Switch title"
                : "لعبة مميزة مقترحة",
          });
        }
      }

      similarList.push(createSimilarGameFromProduct(matched, reasons, customScore));
    }
  }

  // 2. Fallback matching algorithm if we need more candidates (aim for 4 to 8 games)
  if (similarList.length < 5 && catalog.length > 0) {
    const scoredCandidates: Array<{
      cand: Record<string, unknown>;
      score: number;
      reasons: Array<{ kind: SimilarityKind; text: string }>;
    }> = [];

    for (const cand of catalog) {
      const candId = String(cand["id"]);
      if (addedIds.has(candId)) continue;

      let score = 0;
      const reasons: Array<{ kind: SimilarityKind; text: string }> = [];

      // Series match (+40)
      const candSeries = str(cand["seriesName"] || cand["series"]);
      if (currentSeries && candSeries && currentSeries.toLowerCase() === candSeries.toLowerCase()) {
        score += 40;
        reasons.push({
          kind: "story",
          text:
            locale === "en"
              ? `Same series: ${currentSeries}`
              : `من نفس السلسلة: ${currentSeries}`,
        });
      }

      // Genre overlap (+15 per genre)
      const candGenres = Array.isArray(cand["genres"])
        ? (cand["genres"] as string[])
        : str(cand["genre"])
          ? [str(cand["genre"])]
          : [];
      const sharedGenres = currentGenres.filter((g) =>
        candGenres.some((cg) => cg.toLowerCase() === g.toLowerCase()),
      );
      if (sharedGenres.length > 0) {
        score += sharedGenres.length * 15;
        const mainShared = sharedGenres.slice(0, 2).join(locale === "en" ? " & " : " و ");
        reasons.push({
          kind: "genre",
          text: locale === "en" ? `Similar genre: ${mainShared}` : `نوع مشابه: ${mainShared}`,
        });
      }

      // Developer match (+20)
      const candDev = str(cand["developer"] || cand["studioName"] || cand["developerEn"]);
      if (
        currentDeveloper &&
        candDev &&
        currentDeveloper.toLowerCase() === candDev.toLowerCase()
      ) {
        score += 20;
        reasons.push({
          kind: "gameplay",
          text:
            locale === "en"
              ? `Same developer: ${currentDeveloper}`
              : `من نفس المطور: ${currentDeveloper}`,
        });
      }

      // Publisher match (+10)
      const candPub = str(cand["publisher"] || cand["publisherEn"]);
      if (
        currentPublisher &&
        candPub &&
        currentPublisher.toLowerCase() === candPub.toLowerCase() &&
        reasons.length < 2
      ) {
        score += 10;
        reasons.push({
          kind: "nintendo",
          text:
            locale === "en"
              ? `Published by ${currentPublisher}`
              : `من نشر ${currentPublisher}`,
        });
      }

      // Switch 2 enhancement similarity (+5)
      if (bool(p["switch2Enhanced"]) && bool(cand["switch2Enhanced"])) {
        score += 5;
        if (reasons.length < 2) {
          reasons.push({
            kind: "nintendo",
            text: locale === "en" ? "Enhanced for Switch 2" : "محسنة لجهاز Switch 2",
          });
        }
      }

      if (score > 0) {
        scoredCandidates.push({ cand, score, reasons });
      }
    }

    // Sort by score descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    const needed = 8 - similarList.length;
    for (const item of scoredCandidates.slice(0, needed)) {
      const candId = String(item.cand["id"]);
      addedIds.add(candId);
      const normalizedScore = 0.7 + Math.min(0.28, (item.score / 100) * 0.28);
      similarList.push(createSimilarGameFromProduct(item.cand, item.reasons, normalizedScore));
    }
  }

  return similarList.length ? similarList : undefined;
}

function buildPatchNotes(p: Record<string, unknown>, locale: "ar" | "en"): PatchNote[] | undefined {
  const list = rows(p["patchNotes"]);
  if (!list.length) return undefined;
  return list.map((row) => ({
    version: str(row["version"]),
    date: str(row["date"]),
    ...(str(row["body"])
      ? { added: locale === "en" && row["bodyEn"] ? lines(row["bodyEn"]) : lines(row["body"]) }
      : {}),
  }));
}

function buildSoundtrack(p: Record<string, unknown>, locale: "ar" | "en"): Soundtrack | undefined {
  const list = rows(p["soundtrack"]);
  if (!list.length) return undefined;
  return {
    links: list.map((row) => ({
      label: localizedValue(row, "title", "titleEn", locale),
      url: str(row["url"]),
    })),
  };
}

function buildSeries(p: Record<string, unknown>, locale: "ar" | "en"): GameSeries | undefined {
  const name = localizedValue(p, "seriesName", "seriesNameEn", locale);
  const entries = rows(p["seriesEntries"]);
  if (!name && !entries.length) return undefined;
  const mappedEntries = entries
    .map((row) => {
      const v =
        locale === "en" && row["valueEn"]
          ? row["valueEn"]
          : row["value"] !== undefined
            ? row["value"]
            : row["title"] || row["name"] || row;
      const title = getTextValue(
        typeof v === "object" && v !== null && "value" in v ? (v as any).value : v,
      );
      if (!title) return null;
      return { slug: slugify(title), title };
    })
    .filter((e): e is { slug: string; title: string } => Boolean(e));
  if (!mappedEntries.length && !name) return undefined;
  return {
    id: slugify(name || "series"),
    name: name || (locale === "en" ? "Series" : "السلسلة"),
    entries: mappedEntries,
  };
}

function buildVerdict(p: Record<string, unknown>, locale: "ar" | "en"): EditorVerdict | undefined {
  const score = num(p["verdictScore"]);
  const summary = localizedValue(p, "verdictSummary", "verdictSummaryEn", locale);
  const pros = rows(p["verdictPros"])
    .map((r) => {
      const v =
        locale === "en" && r["valueEn"] ? r["valueEn"] : r["value"] !== undefined ? r["value"] : r;
      return getTextValue(
        typeof v === "object" && v !== null && "value" in v ? (v as any).value : v,
      );
    })
    .filter(Boolean);
  const cons = rows(p["verdictCons"])
    .map((r) => {
      const v =
        locale === "en" && r["valueEn"] ? r["valueEn"] : r["value"] !== undefined ? r["value"] : r;
      return getTextValue(
        typeof v === "object" && v !== null && "value" in v ? (v as any).value : v,
      );
    })
    .filter(Boolean);
  if (!score && !summary && !pros.length && !cons.length) return undefined;
  return {
    overall: score || 0,
    scores: {},
    ...(summary ? { summary } : {}),
    buyIf: pros,
    skipIf: cons,
  };
}

function buildCatalogOptions(p: Record<string, unknown>, locale: "ar" | "en") {
  const rawOptions = rows(p["options"]);
  if (rawOptions.length) {
    const list = rawOptions
      .map((opt, i) => {
        const name = getTextValue(
          locale === "en" && opt["nameEn"]
            ? opt["nameEn"]
            : (opt["name"] ?? opt["title"] ?? opt["value"] ?? opt),
        );
        if (!name) return null;
        const rawDesc = localizedValue(opt, "description", "descriptionEn", locale);
        const desc =
          locale === "ar"
            ? resolveOptionStandardDescription(opt["name"] || opt["id"] || name, rawDesc) || rawDesc
            : rawDesc;

        return {
          id: str(opt["id"]) || `opt-${i}`,
          name,
          price: num(opt["price"]) || undefined,
          cost: num(opt["cost"]) || undefined,
          description: desc || undefined,
          available: opt["available"] !== false && opt["active"] !== false,
        };
      })
      .filter((opt): opt is NonNullable<typeof opt> => Boolean(opt && opt.available !== false));
    if (list.length) return list;
  }

  const hubOffers = readOffers(p);
  if (hubOffers.length) {
    const OFFER_NAMES_AR: Record<string, string> = {
      account: "حساب أوفلاين",
      accountOnline: "حساب أونلاين",
      lend: "إقراض كارتلج",
      disc: "قرص",
    };
    const OFFER_NAMES_EN: Record<string, string> = {
      account: "Offline Account",
      accountOnline: "Online Account",
      lend: "Cartridge Lend",
      disc: "Disc",
    };
    const OFFER_NAMES = locale === "en" ? OFFER_NAMES_EN : OFFER_NAMES_AR;
    const list = hubOffers
      .filter((o) => o.available)
      .map((offer) => {
        const desc =
          locale === "ar"
            ? resolveOptionStandardDescription(offer.kind, offer.note) || offer.note
            : offer.note;
        return {
          id: offer.kind,
          name: OFFER_NAMES[offer.kind] ?? offer.kind,
          price: offer.price,
          description: desc || undefined,
          available: true,
        };
      });
    if (list.length) return list;
  }

  return undefined;
}

function buildCatalogTypes(p: Record<string, unknown>, locale: "ar" | "en") {
  const rawTypes = rows(p["types"]);
  if (!rawTypes.length) return undefined;
  const list = rawTypes
    .map((t, i) => {
      const name = getTextValue(
        locale === "en" && t["nameEn"] ? t["nameEn"] : (t["name"] ?? t["title"] ?? t["value"] ?? t),
      );
      if (!name) return null;
      const rawDesc = localizedValue(t, "description", "descriptionEn", locale);
      const desc =
        locale === "ar"
          ? resolveTypeStandardDescription(t["name"] || t["id"] || name, rawDesc) || rawDesc
          : rawDesc;

      return {
        id: str(t["id"]) || `type-${i}`,
        name,
        optionId: str(t["optionId"]) || undefined,
        price: num(t["price"]) || undefined,
        cost: num(t["cost"]) || undefined,
        stock: num(t["stock"]) || undefined,
        description: desc || undefined,
      };
    })
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  return list.length ? list : undefined;
}

function buildOffers(
  p: Record<string, unknown>,
  platform: PlatformId,
  locale: "ar" | "en",
): StoreOffer[] | undefined {
  const hubOffers = readOffers(p);
  if (!hubOffers.length) return undefined;
  const now = new Date().toISOString();
  const formatByKind = {
    account: "digital-account",
    accountOnline: "digital-account",
    lend: "physical",
    disc: "physical",
  } as const;
  const REGIONS = ["US", "JP", "EU", "UK", "HK", "AU", "CA", "BR", "SA", "AE"] as const;
  const named = str(p["accountRegion"]).toUpperCase();
  const accountRegion = (REGIONS as readonly string[]).includes(named)
    ? (named as (typeof REGIONS)[number])
    : "JP";
  return hubOffers.map((offer, i) => ({
    id: `${offer.kind}-${i}`,
    storeId: "banam",
    storeName: locale === "en" ? "Bananto" : "بنانتو",
    firstParty: true,
    official: true,
    region:
      offer.kind === "account" || offer.kind === "accountOnline" ? accountRegion : ("SA" as const),
    format: formatByKind[offer.kind],
    platform,
    price: money(offer.price),
    availability: offer.available
      ? "in-stock"
      : offer.kind === "lend" && offer.preorder
        ? "preorder"
        : "out-of-stock",
    updatedAt: now,
    ...(offer.note ? { notes: offer.note } : {}), // Might need localization on offer.note later
  }));
}

export function gameFromProduct(
  product: Record<string, unknown>,
  locale: "ar" | "en" = "ar",
  allProducts?: Array<Record<string, unknown>>,
): Game {
  const p = product;
  const id = String(p["id"] ?? "");
  const platform: PlatformId = str(p["platform"]) === "switch2" ? "switch2" : "switch";
  const platforms: PlatformId[] = bool(p["switch2Enhanced"]) ? ["switch", "switch2"] : [platform];

  const core = buildCore(p, locale);
  const media = buildMedia(p, locale);

  const developerName =
    localizedValue(p, "developer", "developerEn", locale) ||
    localizedValue(p, "studioName", "studioNameEn", locale);
  const publisherName = localizedValue(p, "publisher", "publisherEn", locale);

  const metacritic = num(p["metacriticRating"]);
  const opencritic = num(p["opencriticRating"]);
  /*
    The import schema stores the player score on a 0-10 scale ("تقييم اللاعبين
    (0-10)"), while the hub's star widgets — and the site's own review
    aggregate — are out of 5. An imported 8.1 rendered as "8.1 / 5". Anything
    above 5 can only be the 10-point scale, so it is halved into the site's.
  */
  const rawUserScore = num(p["userScore"]);
  const userScore = rawUserScore > 5 ? Math.round((rawUserScore / 2) * 10) / 10 : rawUserScore;

  const dataSourceRows = rows(p["dataSources"] || p["sources"]);

  const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
    value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);

  const ageRating = buildAgeRating(p);
  const releaseDate = str(p["releaseDate"]) || undefined;
  const dataSources = dataSourceRows.length
    ? dataSourceRows
        .map((row) => {
          const label = getTextValue(
            locale === "en" && row["nameEn"]
              ? row["nameEn"]
              : row["name"] || row["source"] || row["label"] || row["title"] || row,
          );
          const url = str(row["url"] || row["link"] || row["sourceUrl"]);
          if (!label && !url) return null;
          return {
            label: label || url,
            ...opt("url", url || undefined),
          };
        })
        .filter((d): d is { label: string; url?: string } => Boolean(d))
    : undefined;

  const game: Game = {
    id,
    slug: id,
    title: core.title,
    platforms,
    ...opt("description", core.description),
    ...opt("tagline", core.tagline),
    ...opt("caseSleeve", media.caseSleeve),
    ...opt(
      "nintendoGameCode",
      str(p["nintendoGameCode"]) || str(p["gameCode"]) || str(p["game_code"]) || undefined,
    ),
    ...opt("coverUrl", media.coverUrl),
    ...opt("detailCoverUrl", media.detailCoverUrl),
    ...opt("coverTextureUrl", media.coverTextureUrl),
    ...opt("coverTrim", media.coverTrim),
    ...opt("keyArtUrl", media.keyArtUrl),
    ...opt("images", media.images),
    ...opt("videos", media.videos),
    ...opt("genres", buildGenres(p)),
    ...(developerName ? { developer: { id: slugify(developerName), name: developerName } } : {}),
    ...(publisherName ? { publisher: { id: slugify(publisherName), name: publisherName } } : {}),
    ...opt("releaseDate", releaseDate),
    ...opt("ageRating", ageRating),
    ...(metacritic || opencritic
      ? {
          criticScore: {
            ...(metacritic ? { metacritic } : {}),
            ...(opencritic ? { opencritic } : {}),
          },
        }
      : {}),
    ...opt("userScore", userScore || undefined),
    ...opt("audienceTags", buildFitFor(p, locale)),
    ...opt("nintendo", buildNintendo(p, locale)),
    ...opt("performance", buildPerformance(p, platform, locale)),
    ...opt("storage", buildStorage(p)),
    ...opt("languages", buildLanguages(p)),
    ...opt("multiplayer", buildMultiplayer(p)),
    ...opt("editions", buildEditions(p, locale)),
    ...opt("offers", buildOffers(p, platform, locale)),
    ...opt("features", buildFeatures(p, locale)),
    ...opt("story", buildStory(p, locale)),
    ...opt("gameplayPillars", buildGameplayPillars(p, locale)),
    ...opt("dlc", buildDlc(p, locale)),
    ...opt("guides", buildGuides(p, locale)),
    ...opt("completion", buildCompletion(p)),
    ...opt("faq", buildFaq(p, locale)),
    ...opt("timeline", buildTimeline(p, locale)),
    ...opt("similar", buildSimilar(p, allProducts, locale)),
    ...opt("patchNotes", buildPatchNotes(p, locale)),
    ...opt("soundtrack", buildSoundtrack(p, locale)),
    ...opt("series", buildSeries(p, locale)),
    ...opt("verdict", buildVerdict(p, locale)),
    ...opt("dataSources", dataSources),
    gameIsOffline: bool(p["gameIsOffline"]),
    gameIsOnline: bool(p["gameIsOnline"]),
    gameLanguageLocked: bool(p["gameLanguageLocked"]),
    ...opt("options", buildCatalogOptions(p, locale)),
    ...opt("types", buildCatalogTypes(p, locale)),
    rawProduct: p,
  };

  return game;
}
