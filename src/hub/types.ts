/**
 * Game Hub data model.
 *
 * Two rules govern this file:
 *
 * 1. Almost every field is optional. The hub renders whatever exists and hides
 *    or explicitly labels whatever does not. No section may invent a value to
 *    fill a gap.
 * 2. Anything a user could mistake for a manufacturer claim (frame rates,
 *    resolutions, download sizes, enhancement lists) is wrapped in `Fact<T>`,
 *    which carries a confirmation state and a source. Unconfirmed facts render
 *    as "Not officially confirmed" rather than as a number.
 */

export type PlatformId = "switch" | "switch2" | "ps5" | "ps4" | "xbox-series" | "xbox-one" | "pc";

export type RegionCode = "US" | "JP" | "EU" | "UK" | "HK" | "AU" | "CA" | "BR" | "SA" | "AE";

export type CurrencyCode =
  "USD" | "JPY" | "EUR" | "GBP" | "HKD" | "AUD" | "CAD" | "BRL" | "SAR" | "AED" | "IQD";

/** How a fact was sourced. Drives the confidence label shown next to it. */
export type FactStatus = "confirmed" | "unconfirmed" | "measured";

export interface Fact<T> {
  value: T;
  /** `confirmed` = publisher/first-party. `measured` = tested by the platform's
   *  editorial team. `unconfirmed` = do not present as fact. */
  status: FactStatus;
  /** Human-readable attribution, e.g. "Nintendo eShop listing". */
  source?: string;
  /** ISO date the fact was captured. */
  capturedAt?: string;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

export type ImageCategory = "gameplay" | "characters" | "world" | "combat" | "ui" | "art";

export interface GameImage {
  id: string;
  url: string;
  /** Optional smaller source for grids/thumbnails. */
  thumbUrl?: string;
  alt: string;
  category?: ImageCategory;
  width?: number;
  height?: number;
}

export type VideoKind =
  | "announcement"
  | "trailer"
  | "launch-trailer"
  | "gameplay"
  | "direct"
  | "review"
  | "tips"
  | "walkthrough";

export interface GameVideo {
  id: string;
  kind: VideoKind;
  title: string;
  /** Embeddable URL (privacy-enhanced host preferred). */
  embedUrl: string;
  thumbnailUrl?: string;
  /** Seconds. */
  duration?: number;
  publishedAt?: string;
  channel?: string;
}

/* -------------------------------------------------------------------------- */
/* Nintendo platform detail                                                    */
/* -------------------------------------------------------------------------- */

export type PlayMode = "tv" | "tabletop" | "handheld";

export type PhysicalFormat = "cartridge" | "game-key-card" | "digital";

export interface Switch2Enhancement {
  id:
    | "resolution"
    | "framerate"
    | "hdr"
    | "loading"
    | "textures"
    | "effects"
    | "ray-tracing"
    | "mouse-controls"
    | "gamechat";
  label: string;
  detail?: string;
}

export interface PerformanceProfile {
  platform: PlatformId;
  deviceName?: string;
  deviceSlug?: string;
  deviceModel?: string;
  hardwareId?: string;
  informationStatus?: "available" | "not_published" | "not_tested";
  unavailableReason?: string;
  /** Per play mode where the platform distinguishes them. */
  modes?: Array<{
    mode: PlayMode | "pc-preset";
    label?: string;
    supported?: boolean;
    resolution?: Fact<string>;
    renderingResolution?: Fact<string>;
    outputResolution?: Fact<string>;
    frameRate?: Fact<string>;
    frameRateMin?: Fact<string>;
    frameRateMax?: Fact<string>;
    refreshRate?: Fact<string>;
    hdr?: Fact<boolean>;
    vrr?: Fact<boolean>;
    notes?: string;
  }>;
  performanceModes?: Array<{
    name: string;
    handheldResolution?: string;
    handheldFps?: string;
    tvResolution?: string;
    tvFps?: string;
    hdr?: boolean;
    vrr?: boolean;
    notes?: string;
  }>;
  loadingTime?: Fact<string>;
  hdr?: Fact<boolean>;
  upscaling?: string;
  rayTracing?: boolean;
  rayTracingMode?: string;
  gameVersion?: string;
  patchVersion?: string;
  testedDate?: string;
  sourceName?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  verificationStatus?: "verified" | "official" | "technical_analysis" | "unverified";
  notes?: string;
}

export interface NintendoDetail {
  /** Which Nintendo hardware the game runs on natively. */
  runsOn: Array<"switch" | "switch2">;
  /** True when the title will not run on the original Switch at all. */
  switch2Only?: boolean;
  /** A distinct SKU built for Switch 2 (not just a patch). */
  switch2Edition?: {
    available: boolean;
    name?: string;
    /** Paid upgrade path from an owned Switch copy. */
    upgradePack?: { available: boolean; price?: Money; name?: string };
  };
  /** Free/patched enhancements applied when running on Switch 2. */
  switch2Enhanced?: {
    available: boolean;
    enhancements?: Switch2Enhancement[];
  };
  formats?: PhysicalFormat[];
  /** Physical release that ships a key card rather than the game on cartridge. */
  gameKeyCard?: Fact<boolean>;
  /** Physical copy still needs a download before play. */
  physicalRequiresDownload?: Fact<boolean>;
  playModes?: PlayMode[];
  features?: Array<{
    id:
      | "motion"
      | "hd-rumble"
      | "touchscreen"
      | "gyro"
      | "amiibo"
      | "cloud-saves"
      | "mouse"
      | "gamechat";
    supported: boolean;
    note?: string;
  }>;
  /** Nintendo Switch Online subscription requirement. */
  switchOnline?: {
    requiredForOnlinePlay?: Fact<boolean>;
    requiredForCoreGame?: Fact<boolean>;
    note?: string;
  };
  /** Hub-specific metadata for Benana Store */
  gameIsOffline?: boolean;
  gameIsOnline?: boolean;
  gameLanguageLocked?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Storage, languages, players                                                 */
/* -------------------------------------------------------------------------- */

export interface StorageInfo {
  /** Digital download size in bytes (formatted at render time). */
  downloadSizeBytes?: Fact<number>;
  requiredSpaceBytes?: Fact<number>;
  latestUpdateSizeBytes?: Fact<number>;
  /** Mandatory extra download for the physical copy, if any. */
  additionalDownloadBytes?: Fact<number>;
  microSdRecommended?: boolean;
}

export type LanguageChannel = "interface" | "audio" | "subtitles";

export interface LanguageSupport {
  /** ISO 639-1 where possible. */
  code: string;
  name: string;
  nativeName?: string;
  channels: LanguageChannel[];
}

export interface MultiplayerInfo {
  players?: { min: number; max: number };
  localPlayers?: { min: number; max: number };
  onlinePlayers?: { min: number; max: number };
  coop?: boolean;
  competitive?: boolean;
  splitScreen?: boolean;
  localWireless?: boolean;
  /** Supports local play at all — the flag behind `multiplayer_local`. */
  localMultiplayer?: boolean;
  onlineMultiplayer?: boolean;
  sharedScreen?: boolean;
  notes?: string;
}

/* -------------------------------------------------------------------------- */
/* Commerce                                                                    */
/* -------------------------------------------------------------------------- */

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export type StoreFormat = "digital-code" | "digital-account" | "physical" | "subscription";

export type Availability = "in-stock" | "low-stock" | "out-of-stock" | "preorder" | "delisted";

export interface StoreOffer {
  id: string;
  storeId: string;
  storeName: string;
  /** True for the platform's own inventory (drives "Buy" vs "Go to store"). */
  firstParty?: boolean;
  official?: boolean;
  region: RegionCode;
  editionId?: string;
  format: StoreFormat;
  platform: PlatformId;
  price: Money;
  /** Pre-discount price when the offer is on sale. */
  listPrice?: Money;
  discountPercent?: number;
  availability: Availability;
  /** Sale end, when the store publishes one. */
  saleEndsAt?: string;
  url?: string;
  /** ISO timestamp of the last successful fetch for this offer. */
  updatedAt: string;
  /** Region lock information for codes. */
  regionLocked?: boolean;
  accountRegionRequired?: RegionCode;
  notes?: string;
}

export interface PricePoint {
  /** ISO date. */
  date: string;
  /** Price in the series currency. */
  price: number;
}

export interface PriceHistory {
  currency: CurrencyCode;
  region: RegionCode;
  points: PricePoint[];
  /** Lowest price ever recorded, which may predate the retained series. */
  allTimeLow?: { price: number; date: string };
  allTimeHigh?: { price: number; date: string };
}

export interface EditionContentItem {
  /**
   * Stable identity for the thing being offered.
   *
   * The comparison matrix aligns rows on this, not on `label`, so an edition
   * may describe the same entitlement differently ("Base game" vs "Base game on
   * cartridge") without splitting into two rows that each read as a gap.
   */
  id: string;
  label: string;
  /** Included in this edition. */
  included: boolean;
  note?: string;
}

export interface GameEdition {
  id: string;
  name: string;
  tier: "standard" | "deluxe" | "gold" | "ultimate" | "special" | "collector";
  description?: string;
  contents: EditionContentItem[];
  msrp?: Money;
  /** Optional compare-at price for this edition. */
  listPrice?: Money;
  coverUrl?: string;
  /** Marks the edition the buying guide recommends and why. */
  recommendation?: {
    kind: "best-value" | "best-for-collectors" | "best-for-digital" | "best-for-switch2";
    reason: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

export interface StorySection {
  id: string;
  /** "The World", "The Characters", "The Conflict", "The Journey". */
  title: string;
  body: string;
  imageId?: string;
  /** Hidden behind a reveal control when true. */
  spoiler?: boolean;
}

export type GameplayPillarId =
  | "combat"
  | "exploration"
  | "story"
  | "world"
  | "weapons"
  | "abilities"
  | "enemies"
  | "bosses"
  | "customization"
  | "multiplayer"
  | "coop"
  | "crafting"
  | "progression";

export interface GameplayPillar {
  id: GameplayPillarId;
  title: string;
  description: string;
  imageId?: string;
  videoId?: string;
}

export interface FeatureTag {
  id: string;
  label: string;
}

export interface Dlc {
  id: string;
  name: string;
  coverUrl?: string;
  releaseDate?: string;
  price?: Money;
  contents?: string[];
  playTimeHours?: { min: number; max: number };
  rating?: number;
  /** Straight answer to "do I need this?". */
  necessity?: {
    verdict: "essential" | "recommended" | "optional" | "skip";
    reason: string;
  };
  includedInEditionIds?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  category:
    | "beginner"
    | "tips"
    | "builds"
    | "weapons"
    | "bosses"
    | "secrets"
    | "collectibles"
    | "walkthrough"
    | "completion";
  summary: string;
  /** Minutes. */
  readingTime?: number;
  updatedAt?: string;
  heroImageId?: string;
  /** Markdown-ish body rendered as paragraphs and steps. */
  sections?: Array<{ heading?: string; body?: string; steps?: string[] }>;
  spoilerLevel?: "none" | "light" | "heavy";
}

export interface CompletionInfo {
  collectibles?: Array<{ label: string; total: number }>;
  challenges?: Array<{ label: string; total?: number }>;
  inGameAchievements?: { supported: boolean; total?: number; note?: string };
  hundredPercentHours?: { min: number; max: number };
  mainStoryHours?: { min: number; max: number };
  mainPlusExtrasHours?: { min: number; max: number };
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface TimelineEvent {
  id: string;
  date: string;
  kind: "announcement" | "trailer" | "demo" | "release" | "update" | "dlc" | "expansion";
  title: string;
  detail?: string;
  videoId?: string;
  version?: string;
  sourceUrl?: string;
  url?: string;
}

export interface PatchNote {
  version: string;
  date: string;
  platforms?: PlatformId[];
  added?: string[];
  fixed?: string[];
  balance?: string[];
  performance?: string[];
  url?: string;
}

export interface Soundtrack {
  composer?: string;
  mainTheme?: { title: string; embedUrl?: string };
  trackCount?: number;
  /** Official/licensed listening links only. */
  links?: Array<{ label: string; url: string }>;
}

export interface SeriesEntry {
  slug: string;
  title: string;
  coverUrl?: string;
  releaseDate?: string;
  /** Position in the story, when the series has one. */
  chronologicalOrder?: number;
  releaseOrder?: number;
  status?: "released" | "current" | "upcoming";
}

export interface GameSeries {
  id: string;
  name: string;
  entries: SeriesEntry[];
}

export type SimilarityKind =
  "gameplay" | "story" | "genre" | "nintendo" | "difficulty" | "audience";

export interface SimilarGame {
  slug: string;
  title: string;
  coverUrl?: string;
  price?: Money;
  rating?: number;
  platforms?: PlatformId[];
  /** Why this is being recommended — always shown to the user. */
  reasons: Array<{ kind: SimilarityKind; text: string }>;
  matchScore?: number;
}

export interface Accessory {
  id: string;
  name: string;
  category: "subscription" | "controller" | "storage" | "case" | "headset" | "other";
  imageUrl?: string;
  price?: Money;
  /** Why the game needs it, e.g. "18.7 GB download". */
  reason?: string;
  required?: boolean;
  url?: string;
}

/* -------------------------------------------------------------------------- */
/* Community & reviews                                                         */
/* -------------------------------------------------------------------------- */

export type ReviewAspect =
  "story" | "gameplay" | "graphics" | "performance" | "value" | "replayability";

export interface UserReview {
  id: string;
  author: { id: string; name: string; avatarUrl?: string };
  rating: number;
  aspects?: Partial<Record<ReviewAspect, number>>;
  title?: string;
  body: string;
  createdAt: string;
  platform?: PlatformId;
  playTimeHours?: number;
  verifiedPurchase?: boolean;
  helpfulCount?: number;
  recommended?: boolean;
}

export interface ReviewSummary {
  average: number;
  total: number;
  recommendedPercent?: number;
  aspectAverages?: Partial<Record<ReviewAspect, number>>;
  distribution?: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export type CommunityKind = "question" | "tip" | "discussion" | "guide";

export interface CommunityPost {
  id: string;
  kind: CommunityKind;
  title: string;
  body: string;
  author: { id: string; name: string; avatarUrl?: string };
  createdAt: string;
  upvotes: number;
  downvotes: number;
  answerCount: number;
  /** Marked by the asker or a moderator. */
  resolved?: boolean;
  tags?: string[];
}

export interface EditorVerdict {
  overall: number;
  scores: Partial<
    Record<"gameplay" | "story" | "graphics" | "performance" | "value" | "nintendo", number>
  >;
  headline?: string;
  summary?: string;
  buyIf: string[];
  skipIf: string[];
  author?: { name: string; role?: string };
  updatedAt?: string;
}

/* -------------------------------------------------------------------------- */
/* Purchase flow                                                               */
/* -------------------------------------------------------------------------- */

export interface PurchaseInfo {
  steps?: Array<{ title: string; detail?: string }>;
  supportedRegions?: RegionCode[];
  accountRegionRequirement?: string;
  regionLocked?: boolean;
  deliveryTime?: string;
  notes?: string[];
  warnings?: string[];
}

/* -------------------------------------------------------------------------- */
/* Root                                                                        */
/* -------------------------------------------------------------------------- */

export interface AudienceTag {
  id: string;
  label: string;
  /** Rendered with a warm tone when true (e.g. "Family Friendly"). */
  positive?: boolean;
}

export interface Game {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  /** Short hook used in hero + meta description. */
  tagline?: string;

  coverUrl?: string;
  /**
   * Highest-resolution front cover available, for the WebGL sleeve texture.
   *
   * Separate from `coverUrl` because a listing thumbnail is fine on a card and
   * visibly soft once it is stretched across a 3D face — see
   * `resolveNintendoImage(product, "3d-texture")`.
   */
  coverTextureUrl?: string;
  /**
   * The product detail page's primary cover (`coverImage`). Distinct from
   * `coverUrl`, which is the listing box shot the 3D sleeve composes from.
   */
  detailCoverUrl?: string;
  /**
   * Crop rectangle for `coverUrl`, as fractions of the source image, when the
   * catalogue carries a precomputed one. See `@/lib/imageTrim`.
   */
  coverTrim?: unknown;
  /**
   * The printed retail sleeve, back │ spine │ front in one image.
   *
   * When present the 3D case samples this directly, so the Nintendo band, the
   * lockup and the spine come from the real artwork instead of being drawn.
   * `coverUrl` is only the fallback for records that have front key art alone.
   */
  caseSleeve?: {
    url: string;
    layout?: { backEnd: number; frontStart: number };
  };
  /**
   * Nintendo's five-character game code (`AACCA`). When present, the retail
   * sleeve can be resolved automatically — see `services/coverArtService`.
   */
  nintendoGameCode?: string;
  /** Wide key art used for the hero backdrop. */
  keyArtUrl?: string;
  logoUrl?: string;

  platforms: PlatformId[];
  genres?: string[];
  developer?: { id: string; name: string; slug?: string };
  publisher?: { id: string; name: string; slug?: string };
  releaseDate?: string;
  /** Per-platform release dates when they differ. */
  releaseDates?: Partial<Record<PlatformId, string>>;
  ageRating?: { system: "ESRB" | "PEGI" | "CERO" | "USK"; label: string; descriptors?: string[] };
  exclusive?: "nintendo" | "console" | "timed" | null;

  criticScore?: { metacritic?: number; opencritic?: number };
  /** Aggregate of this platform's own user reviews. */
  userScore?: number;

  images?: GameImage[];
  videos?: GameVideo[];

  nintendo?: NintendoDetail;
  performance?: PerformanceProfile[];
  storage?: StorageInfo;
  languages?: LanguageSupport[];
  multiplayer?: MultiplayerInfo;

  editions?: GameEdition[];
  offers?: StoreOffer[];
  priceHistory?: PriceHistory[];

  audienceTags?: AudienceTag[];
  features?: FeatureTag[];
  story?: StorySection[];
  gameplayPillars?: GameplayPillar[];
  dlc?: Dlc[];
  guides?: Guide[];
  completion?: CompletionInfo;
  faq?: FaqItem[];
  timeline?: TimelineEvent[];
  patchNotes?: PatchNote[];
  soundtrack?: Soundtrack;
  series?: GameSeries;
  similar?: SimilarGame[];
  accessories?: Accessory[];

  verdict?: EditorVerdict;
  reviewSummary?: ReviewSummary;
  reviews?: UserReview[];
  community?: CommunityPost[];

  purchase?: PurchaseInfo;

  /** Catalog Options (e.g. Offline account, Online account, etc.) */
  options?: Array<{
    id: string;
    name: string;
    /** Compare-at price; `price` is still the amount charged. */
    originalPrice?: number;
    price?: number;
    cost?: number;
    description?: string;
    available?: boolean;
  }>;
  /** Catalog Types / Variants (e.g. Standard edition, DLC pack, etc.) */
  types?: Array<{
    id: string;
    name: string;
    optionId?: string;
    /** Compare-at price; `price` is still the amount charged. */
    originalPrice?: number;
    price?: number;
    cost?: number;
    stock?: number;
    description?: string;
  }>;
  rawProduct?: Record<string, unknown>;

  /** Benana Store Specific Meta */
  gameIsOffline?: boolean;
  gameIsOnline?: boolean;
  gameLanguageLocked?: boolean;

  /** Attribution for the whole record; surfaced in the data-transparency note. */
  dataSources?: Array<{ label: string; url?: string; updatedAt?: string }>;
}

/** Lightweight shape used by search, discovery and carousels. */
export interface GameSummary {
  id: string;
  slug: string;
  title: string;
  coverUrl?: string;
  platforms: PlatformId[];
  genres?: string[];
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  price?: Money;
  rating?: number;
  players?: { min: number; max: number };
  downloadSizeBytes?: number;
  features?: string[];
}
