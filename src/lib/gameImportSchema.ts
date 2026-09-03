export interface FieldDef {
  key: string;
  type:
    "string" | "number" | "boolean" | "date" | "url" | "array" | "object" | "multiline" | "integer";
  target: string;
  required?: boolean;
  defaultValue?: any;
  group?: string;
  repeatable?: boolean;
  itemFields?: Record<string, FieldDef>;
  validation?: { min?: number; max?: number };
  /** How many indexed repeats the generated template should print (default 3). */
  templateRepeat?: number;
  description?: string;
}

const DEVICE_MODE_FIELDS: Record<string, FieldDef> = {
  supported: { key: "supported", type: "boolean", target: "supported" },
  resolution: { key: "resolution", type: "string", target: "resolution" },
  /* A flag, not a resolution: true = dynamic, false = fixed, blank = unknown.
     The measured values live in resolution / rendering_resolution / output_resolution. */
  resolution_dynamic: {
    key: "resolution_dynamic",
    type: "boolean",
    target: "resolutionDynamic",
  },
  rendering_resolution: {
    key: "rendering_resolution",
    type: "string",
    target: "renderingResolution",
  },
  output_resolution: {
    key: "output_resolution",
    type: "string",
    target: "outputResolution",
  },
  fps: { key: "fps", type: "string", target: "fps" },
  fps_min: { key: "fps_min", type: "string", target: "fpsMin" },
  fps_max: { key: "fps_max", type: "string", target: "fpsMax" },
  refresh_rate: { key: "refresh_rate", type: "string", target: "refreshRate" },
  hdr: { key: "hdr", type: "boolean", target: "hdr" },
  vrr: { key: "vrr", type: "boolean", target: "vrr" },
  mode: { key: "mode", type: "string", target: "mode" },
  notes: { key: "notes", type: "multiline", target: "notes" },
};

const PERFORMANCE_MODE_FIELDS: Record<string, FieldDef> = {
  name: { key: "name", type: "string", target: "name", required: true },
  handheld_resolution: {
    key: "handheld_resolution",
    type: "string",
    target: "handheldResolution",
  },
  handheld_fps: { key: "handheld_fps", type: "string", target: "handheldFps" },
  tv_resolution: { key: "tv_resolution", type: "string", target: "tvResolution" },
  tv_fps: { key: "tv_fps", type: "string", target: "tvFps" },
  hdr: { key: "hdr", type: "boolean", target: "hdr" },
  vrr: { key: "vrr", type: "boolean", target: "vrr" },
  notes: { key: "notes", type: "multiline", target: "notes" },
};

export const GAME_IMPORT_SCHEMA: FieldDef[] = [
  // Versioning
  { key: "schema_version", type: "number", target: "schema_version", required: true },

  // GAME Basic Info
  { key: "name", type: "string", target: "title", required: true, description: "اسم اللعبة" },
  { key: "title", type: "string", target: "title", description: "اسم اللعبة (بديل لـ name)" },
  { key: "title_ar", type: "string", target: "titleAr", description: "اسم اللعبة بالعربية" },
  /*
    The Chinese supplier name — admin and fulfilment only.

    `target` is deliberately a name nothing on the product document uses:
    the value is lifted out of the parsed record by the importer and written
    to `product_admin_metadata`, which no public serializer reads. It is
    declared here so the template asks for it and the parser accepts it, not
    so it can live on the product.
  */
  {
    key: "supplier_name_zh_cn",
    type: "string",
    target: "supplierNameZhCn",
    description:
      "الاسم الصيني المبسّط لدى المورّد — إداري وسري، لا يظهر للعميل إطلاقاً",
  },
  {
    key: "supplier_name_zh_source_url",
    type: "string",
    target: "supplierNameZhSourceUrl",
    description: "رابط مصدر الاسم الصيني (نينتندو الرسمي أو الناشر)",
  },
  { key: "name_ar", type: "string", target: "titleAr", description: "اسم اللعبة بالعربية" },
  {
    key: "slug",
    type: "string",
    target: "slug",
    description: "رابط اللعبة (Slug) - اختياري، سيتم توليده تلقائياً إذا كان فارغاً",
  },
  {
    key: "platform",
    type: "string",
    target: "platform",
    required: true,
    description: "المنصة: switch1 / switch2 / both",
  },
  {
    key: "compatibility",
    type: "array",
    target: "compatibility",
    repeatable: true,
    description: "الأجهزة المتوافقة (بديل إضافي للمنصة، عدد غير محدود)",
  },
  {
    key: "edition",
    type: "string",
    target: "edition",
    description: "الإصدار (Standard, Deluxe, etc.)",
  },
  {
    key: "region",
    type: "string",
    target: "region",
    description: "المنطقة (Global, USA, EUR, JPN)",
  },
  {
    key: "release_date",
    type: "date",
    target: "releaseDate",
    description: "تاريخ الإصدار YYYY-MM-DD",
  },
  {
    key: "release_status",
    type: "string",
    target: "status",
    description: "حالة الإصدار (نشط، قادم)",
  },
  { key: "status", type: "string", target: "status", description: "الحالة (نشط، قادم، غير متوفر)" },
  { key: "developer", type: "string", target: "developer", description: "المطور" },
  { key: "publisher", type: "string", target: "publisher", description: "الناشر" },
  { key: "franchise", type: "string", target: "seriesName", description: "اسم السلسلة (صيغة قديمة)" },
  { key: "players_count", type: "string", target: "numberOfPlayers", description: "عدد اللاعبين" },
  { key: "players", type: "string", target: "numberOfPlayers", description: "عدد اللاعبين" },
  { key: "player_count", type: "string", target: "numberOfPlayers", description: "عدد اللاعبين" },
  { key: "age_rating", type: "string", target: "ageRating", description: "التصنيف العمري" },
  {
    key: "metacritic_score",
    type: "number",
    target: "metacriticRating",
    validation: { min: 0, max: 100 },
    description: "تقييم Metacritic (0-100)",
  },
  {
    key: "metacritic",
    type: "number",
    target: "metacriticRating",
    validation: { min: 0, max: 100 },
    description: "تقييم Metacritic (0-100)",
  },
  { key: "metacritic_url", type: "url", target: "metacriticUrl", description: "رابط Metacritic" },
  {
    key: "opencritic_score",
    type: "number",
    target: "opencriticRating",
    validation: { min: 0, max: 100 },
    description: "تقييم Opencritic (0-100)",
  },
  {
    key: "opencritic",
    type: "number",
    target: "opencriticRating",
    validation: { min: 0, max: 100 },
    description: "تقييم Opencritic (0-100)",
  },
  {
    key: "user_score",
    type: "number",
    target: "userScore",
    validation: { min: 0, max: 10 },
    description: "تقييم اللاعبين (0-10)",
  },
  {
    key: "userscore",
    type: "number",
    target: "userScore",
    validation: { min: 0, max: 10 },
    description: "تقييم اللاعبين (0-10)",
  },
  {
    key: "user_rating",
    type: "number",
    target: "userScore",
    validation: { min: 0, max: 10 },
    description: "تقييم اللاعبين (0-10)",
  },
  { key: "game_size_gb", type: "number", target: "size", description: "حجم اللعبة بالجيجابايت" },
  { key: "size", type: "string", target: "size", description: "حجم اللعبة" },
  { key: "size_gb", type: "number", target: "size", description: "حجم اللعبة بالجيجابايت" },
  { key: "price", type: "number", target: "price", description: "السعر الأساسي بالدينار" },
  { key: "price_iqd", type: "number", target: "price", description: "السعر بالدينار العراقي" },
  { key: "price_usd", type: "number", target: "price_usd", description: "السعر بالدولار الأمريكي" },
  { key: "cost", type: "number", target: "cost", description: "تكلفة المنتج" },
  { key: "cost_iqd", type: "number", target: "cost", description: "التكلفة بالدينار" },
  { key: "stock", type: "number", target: "stock", description: "الكمية المتوفرة" },
  {
    key: "is_infinite_stock",
    type: "boolean",
    target: "isInfiniteStock",
    defaultValue: true,
    description: "هل المخزون غير محدود (الألعاب غير محدودة المخزون افتراضياً)",
  },
  {
    key: "is_hidden",
    type: "boolean",
    target: "isHidden",
    defaultValue: false,
    description: "هل المنتج مخفي عن المستخدمين",
  },
  {
    key: "trade_value",
    type: "number",
    target: "trade_value_iqd",
    description: "قيمة الاستبدال بالدينار",
  },
  {
    key: "trade_value_iqd",
    type: "number",
    target: "trade_value_iqd",
    description: "قيمة الاستبدال بالدينار",
  },
  {
    key: "store_offer_bonus",
    type: "number",
    target: "store_offer_bonus_iqd",
    description: "بونص العرض",
  },
  {
    key: "store_offer_bonus_iqd",
    type: "number",
    target: "store_offer_bonus_iqd",
    description: "بونص العرض بالدينار",
  },
  { key: "official_url", type: "url", target: "officialUrl", description: "رابط الموقع الرسمي" },
  { key: "eshop_url", type: "url", target: "eshopUrl", description: "رابط eShop" },
  { key: "display_order", type: "number", target: "displayOrder", description: "ترتيب العرض" },
  {
    key: "kind",
    type: "string",
    target: "kind",
    description: "نوع المنتج (account, physical, etc.)",
  },
  { key: "category", type: "string", target: "category", description: "معرف القسم" },

  // Availability & Accounts
  {
    key: "game_is_offline",
    type: "boolean",
    target: "gameIsOffline",
    description: "هل اللعبة اوفلاين",
  },
  {
    key: "game_is_online",
    type: "boolean",
    target: "gameIsOnline",
    description: "هل تستطيع اللعب اونلاين",
  },
  {
    key: "game_language_locked",
    type: "boolean",
    target: "gameLanguageLocked",
    description: "هل فيها قفل لغة اقليمي",
  },

  // DESCRIPTION
  {
    key: "description_short",
    type: "string",
    target: "description_short",
    description: "الوصف المختصر",
  },
  {
    key: "description_full",
    type: "multiline",
    target: "description",
    description: "الوصف الكامل",
  },
  {
    key: "description",
    type: "multiline",
    target: "description",
    description: "الوصف الكامل",
  },
  {
    key: "description_en",
    type: "multiline",
    target: "description",
    description: "الوصف بالإنجليزية",
  },
  {
    key: "description_ar",
    type: "multiline",
    target: "description_ar",
    description: "الوصف بالعربية",
  },

  /*
    IMAGES

    `cartridgeImage` is the canonical FRONT BOX COVER: a clean, vertical,
    rectangular retail packshot, high resolution, tight to the box, with no
    mockup scene behind it. The key keeps its old name so every existing row and
    template stays valid, but `front_cover_image` is the name to write in new
    templates because it says what the field actually is.

    `nintendoCardImage` is the separate square / near-square artwork for compact
    platform cards. It is NOT a cover and never substitutes for one — see
    `src/lib/nintendoImages.ts` for the resolver that enforces that.
  */
  {
    key: "front_cover_image",
    type: "url",
    target: "cartridgeImage",
    description: "صورة الغلاف الأمامي للعلبة (مستطيلة، عمودية، بدون هوامش بيضاء)",
  },
  {
    key: "cartridge_image",
    type: "url",
    target: "cartridgeImage",
    description: "صورة الغلاف الأمامي للعلبة (الاسم القديم لـ front_cover_image)",
  },
  {
    key: "cartridge",
    type: "url",
    target: "cartridgeImage",
    description: "صورة الغلاف الأمامي للعلبة",
  },
  {
    key: "cartridge_url",
    type: "url",
    target: "cartridgeImage",
    description: "رابط صورة الغلاف الأمامي للعلبة",
  },
  {
    key: "nintendo_card_image",
    type: "url",
    target: "nintendoCardImage",
    description: "صورة مربعة لبطاقات الألعاب المصغّرة (ليست غلاف العلبة)",
  },
  {
    key: "square_game_image",
    type: "url",
    target: "nintendoCardImage",
    description: "صورة مربعة لبطاقات الألعاب المصغّرة",
  },
  {
    key: "front_cover_hires_url",
    type: "url",
    target: "coverHiResImage",
    description:
      "3D Texture Source: الغلاف الكامل للعلبة بدقة عالية — Back Cover + Spine + Front Cover في صورة واحدة بدون قص",
  },
  {
    key: "cover_texture_url",
    type: "url",
    target: "coverHiResImage",
    description:
      "3D Texture Source: الغلاف الكامل للعلبة (خلفي + كعب + أمامي) في صورة واحدة، تُنزَّل وتُخزَّن تلقائياً عند الاستيراد",
  },
  {
    key: "cover_image",
    type: "url",
    target: "coverImage",
    description: "صورة الغلاف (تظهر في تفاصيل المنتج)",
  },
  {
    key: "cover",
    type: "url",
    target: "coverImage",
    description: "صورة الغلاف",
  },
  {
    key: "cover_url",
    type: "url",
    target: "coverImage",
    description: "رابط صورة الغلاف",
  },
  {
    key: "main_image",
    type: "url",
    target: "coverImage",
    description: "الصورة الرئيسية",
  },
  {
    key: "image",
    type: "url",
    target: "coverImage",
    description: "صورة المنتج",
  },
  {
    key: "image_url",
    type: "url",
    target: "coverImage",
    description: "رابط الصورة",
  },
  {
    key: "box_front_url",
    type: "url",
    target: "box_front_url",
    description: "صورة الغلاف الأمامي",
  },
  { key: "box_back_url", type: "url", target: "box_back_url", description: "صورة الغلاف الخلفي" },

  // Repeatable Images
  {
    key: "banner_image",
    type: "url",
    target: "bannerImages",
    repeatable: true,
    /* Examples, not a ceiling: banner_image.11 and beyond parse fine. */
    templateRepeat: 10,
    description:
      "صور البنر / المعرض الرئيسي — بنرات وصور رسمية عالية الدقة، بدون تكرار أو مصغّرات أو روابط معطلة (الأرقام أمثلة وليست حداً أقصى)",
  },

  // MEDIA
  {
    key: "trailer_url",
    type: "url",
    target: "youtubeTrailer",
    description: "رابط التريلر (يوتيوب)",
  },

  // Video List
  {
    key: "video",
    type: "object",
    target: "videos",
    repeatable: true,
    itemFields: {
      title: { key: "title", type: "string", target: "title" },
      url: { key: "url", type: "url", target: "url" },
    },
    description: "قائمة الفيديوهات",
  },

  // TECHNICAL
  { key: "nsuid", type: "string", target: "nsuid", description: "NSUID" },
  { key: "title_id", type: "string", target: "title_id", description: "Title ID" },
  { key: "product_code", type: "string", target: "product_code", description: "Product Code" },

  // GENRES
  { key: "genre", type: "array", target: "genres", repeatable: true, description: "الأنواع" },
  { key: "genres", type: "array", target: "genres", repeatable: true, description: "الأنواع" },

  // NINTENDO DETAILS
  {
    key: "nintendo_official_url",
    type: "url",
    target: "nintendoEshopUrl",
    description: "رابط eShop الرسمي",
  },
  {
    key: "official_store_url",
    type: "url",
    target: "nintendoEshopUrl",
    description: "رابط المتجر الرسمي",
  },
  {
    key: "nintendo_requires_switch_online",
    type: "boolean",
    target: "nintendoOnlineRequired",
    description: "تتطلب Switch Online",
  },
  {
    key: "requires_nintendo_switch_online",
    type: "boolean",
    target: "nintendoOnlineRequired",
    description: "تتطلب اشتراك Switch Online",
  },
  {
    key: "nintendo_cloud_save",
    type: "boolean",
    target: "nintendoCloudSaves",
    description: "يدعم الحفظ السحابي",
  },
  {
    key: "save_data_cloud",
    type: "boolean",
    target: "nintendoCloudSaves",
    description: "حفظ البيانات سحابياً",
  },
  {
    key: "nintendo_game_key_card",
    type: "boolean",
    target: "nintendoGameKeyCard",
    description: "بطاقة مفتاح اللعبة",
  },
  {
    key: "game_key_card",
    type: "boolean",
    target: "nintendoGameKeyCard",
    description: "بطاقة مفتاح اللعبة",
  },
  {
    key: "nintendo_physical_requires_download",
    type: "boolean",
    target: "nintendoPhysicalNeedsDownload",
    description: "النسخة الفعلية تتطلب تنزيلاً",
  },
  {
    key: "physical_download_required",
    type: "boolean",
    target: "nintendoPhysicalNeedsDownload",
    description: "النسخة الفيزيائية تتطلب تنزيلاً",
  },
  {
    key: "tv_mode",
    type: "boolean",
    target: "tvMode",
    description: "يدعم وضع التلفزيون",
  },
  {
    key: "tabletop_mode",
    type: "boolean",
    target: "tabletopMode",
    description: "يدعم وضع سطح الطاولة",
  },
  {
    key: "handheld_mode",
    type: "boolean",
    target: "handheldMode",
    description: "يدعم الوضع المحمول",
  },
  {
    key: "nintendo_play_modes",
    type: "string",
    target: "nintendoPlayModes",
    description: "أنماط اللعب (تلفاز، محمول، طاولة)",
  },
  {
    key: "supported_play_mode",
    type: "array",
    target: "nintendoPlayModes",
    repeatable: true,
    description: "أنماط اللعب (صيغة قديمة متكررة)",
  },
  {
    key: "nintendo_notes",
    type: "multiline",
    target: "nintendoNotes",
    description: "ملاحظات نينتندو",
  },

  // SWITCH 2
  {
    key: "switch2_enhanced",
    type: "boolean",
    target: "switch2Enhanced",
    description: "نسخة محسنة لـ Switch 2",
  },
  {
    key: "switch_2_enhanced",
    type: "boolean",
    target: "switch2Enhanced",
    description: "نسخة محسنة لـ Switch 2",
  },
  {
    key: "switch_2_exclusive",
    type: "boolean",
    target: "switch2Exclusive",
    description: "حصري لـ Switch 2",
  },
  {
    key: "upgrade_price",
    type: "number",
    target: "switch2UpgradePrice",
    description: "سعر الترقية لـ Switch 2",
  },
  {
    key: "switch2_feature",
    type: "array",
    target: "switch2Features",
    repeatable: true,
    description: "مزايا Switch 2",
  },
  {
    key: "switch2_features",
    type: "array",
    target: "switch2Features",
    repeatable: true,
    description: "مزايا Switch 2",
  },

  // OVERVIEW
  { key: "overview_tagline", type: "string", target: "tagline", description: "سطر التعريف" },
  {
    key: "overview_suitable_for",
    type: "object",
    target: "fitFor",
    repeatable: true,
    itemFields: { value: { key: "value", type: "string", target: "value" } },
    description: "تناسب من؟",
  },
  {
    key: "overview_not_suitable_for",
    type: "object",
    target: "notFitFor",
    repeatable: true,
    itemFields: { value: { key: "value", type: "string", target: "value" } },
    description: "لا تناسب من؟",
  },
  {
    key: "main_story_hours",
    type: "number",
    target: "playTimeMain",
    description: "ساعات القصة الرئيسية",
  },
  {
    key: "completionist_hours",
    type: "number",
    target: "playTimeFull",
    description: "ساعات الإكمال الكامل",
  },

  // EDITIONS
  {
    key: "edition",
    type: "object",
    target: "editionsList",
    repeatable: true,
    itemFields: {
      name: { key: "name", type: "string", target: "name" },
      cover_image: { key: "cover_image", type: "url", target: "coverUrl" },
      content: {
        key: "content",
        type: "object",
        target: "contents",
        repeatable: true,
        itemFields: { label: { key: "label", type: "string", target: "label" } },
      },
    },
    description: "النسخ والإصدارات",
  },

  // GAMEPLAY STYLE
  {
    key: "gameplay_pillar",
    type: "object",
    target: "gameplayPillars",
    repeatable: true,
    itemFields: {
      title: { key: "title", type: "string", target: "title" },
      description: { key: "description", type: "multiline", target: "description" },
      image: { key: "image", type: "url", target: "imageUrl" },
    },
    description: "ركائز اللعب (تجربة اللعبة)",
  },

  // STORY
  {
    key: "world_summary",
    type: "multiline",
    target: "worldSummary",
    description: "ملخص عالم اللعبة",
  },
  {
    key: "story_chapter",
    type: "object",
    target: "storyChapters",
    repeatable: true,
    itemFields: {
      title: { key: "title", type: "string", target: "title" },
      text: { key: "text", type: "multiline", target: "body" },
      image: { key: "image", type: "url", target: "imageUrl" },
    },
    description: "فصول القصة (العالم والقصة)",
  },

  // GALLERY
  {
    key: "gallery",
    type: "object",
    target: "galleryImages",
    repeatable: true,
    /* Examples, not a ceiling: gallery.13 and beyond parse fine. */
    templateRepeat: 12,
    itemFields: {
      image: { key: "image", type: "url", target: "url" },
      description: { key: "description", type: "string", target: "alt" },
    },
    description:
      "معرض الصور — لقطات وصور رسمية عالية الدقة، بدون تكرار أو مصغّرات أو صور غير متعلقة (الأرقام أمثلة وليست حداً أقصى)",
  },

  // FEATURES
  {
    key: "feature",
    type: "object",
    target: "features",
    repeatable: true,
    itemFields: { value: { key: "value", type: "string", target: "value" } },
    description: "المميزات",
  },

  // PERFORMANCE
  {
    key: "performance_tv_resolution",
    type: "string",
    target: "perfResolutionDocked",
    description: "الدقة (تلفاز)",
  },
  {
    key: "performance_handheld_resolution",
    type: "string",
    target: "perfResolutionHandheld",
    description: "الدقة (محمول)",
  },
  { key: "performance_fps", type: "string", target: "perfFps", description: "الإطارات في الثانية" },
  { key: "performance_hdr", type: "boolean", target: "perfHdr", description: "يدعم HDR" },
  {
    key: "performance_notes",
    type: "multiline",
    target: "perfNotes",
    description: "ملاحظات الأداء",
  },

  // DEVICE PERFORMANCE — the game record is the source of truth. Hardware
  // products only describe maximum capabilities and never populate these.
  {
    key: "device_performance",
    type: "object",
    target: "devicePerformance",
    repeatable: true,
    itemFields: {
      device: { key: "device", type: "string", target: "device" },
      device_slug: { key: "device_slug", type: "string", target: "deviceSlug" },
      device_model: { key: "device_model", type: "string", target: "deviceModel" },
      hardware_id: { key: "hardware_id", type: "string", target: "hardwareId" },
      information_status: {
        key: "information_status",
        type: "string",
        target: "informationStatus",
      },
      unavailable_reason: {
        key: "unavailable_reason",
        type: "multiline",
        target: "unavailableReason",
      },
      handheld: {
        key: "handheld",
        type: "object",
        target: "handheld",
        itemFields: DEVICE_MODE_FIELDS,
      },
      tv: {
        key: "tv",
        type: "object",
        target: "tv",
        itemFields: DEVICE_MODE_FIELDS,
      },
      mode: {
        key: "mode",
        type: "object",
        target: "modes",
        repeatable: true,
        itemFields: PERFORMANCE_MODE_FIELDS,
      },
      upscaling: { key: "upscaling", type: "string", target: "upscaling" },
      ray_tracing: { key: "ray_tracing", type: "boolean", target: "rayTracing" },
      ray_tracing_mode: {
        key: "ray_tracing_mode",
        type: "string",
        target: "rayTracingMode",
      },
      loading_time: { key: "loading_time", type: "string", target: "loadingTime" },
      loading_notes: { key: "loading_notes", type: "multiline", target: "loadingNotes" },
      game_version: { key: "game_version", type: "string", target: "gameVersion" },
      patch_version: { key: "patch_version", type: "string", target: "patchVersion" },
      tested_date: { key: "tested_date", type: "date", target: "testedDate" },
      source_name: { key: "source_name", type: "string", target: "sourceName" },
      source_url: { key: "source_url", type: "url", target: "sourceUrl" },
      verified_at: { key: "verified_at", type: "date", target: "verifiedAt" },
      verification_status: {
        key: "verification_status",
        type: "string",
        target: "verificationStatus",
      },
      performance_notes: {
        key: "performance_notes",
        type: "multiline",
        target: "performanceNotes",
      },
    },
    description: "أداء اللعبة الفعلي على جهاز محدد (عدد أجهزة وأنماط غير محدود)",
  },

  // STORAGE
  {
    key: "storage_download_size_gb",
    type: "number",
    target: "downloadSizeGb",
    description: "حجم التنزيل (GB)",
  },
  {
    key: "storage_required_space_gb",
    type: "number",
    target: "requiredSpaceGb",
    description: "المساحة المطلوبة (GB)",
  },
  {
    key: "storage_micro_sd_recommended",
    type: "boolean",
    target: "microSdRecommended",
    description: "ينصح ببطاقة microSD",
  },
  {
    key: "storage_notes",
    type: "multiline",
    target: "storageNotes",
    description: "ملاحظات التخزين",
  },

  // LANGUAGES
  {
    key: "audio_language",
    type: "array",
    target: "languagesAudio",
    repeatable: true,
    description: "لغات الصوت",
  },
  {
    key: "text_language",
    type: "array",
    target: "languagesText",
    repeatable: true,
    description: "لغات النصوص",
  },
  {
    key: "supported_languages_raw",
    type: "string",
    target: "supportedLanguages",
    description: "اللغات المدعومة (نص حر)",
  },
  { key: "supports_arabic", type: "boolean", target: "arabicSupport", description: "يدعم العربية" },

  // MULTIPLAYER
  { key: "multiplayer_local", type: "boolean", target: "mpLocalPlayers", description: "لعب محلي" },
  {
    key: "multiplayer_online",
    type: "boolean",
    target: "mpOnlinePlayers",
    description: "لعب أونلاين",
  },
  { key: "multiplayer_cooperative", type: "boolean", target: "mpCoop", description: "لعب تعاوني" },
  {
    key: "multiplayer_competitive",
    type: "boolean",
    target: "mpCompetitive",
    description: "لعب تنافسي",
  },
  {
    key: "multiplayer_split_screen",
    type: "boolean",
    target: "mpSplitScreen",
    description: "شاشة مقسومة",
  },
  {
    key: "multiplayer_local_wireless",
    type: "boolean",
    target: "mpLocalWireless",
    description: "لاسلكي محلي",
  },

  // DLC
  {
    key: "dlc",
    type: "string",
    target: "dlcSummary",
    description: "ملخص الإضافات (صيغة قديمة للحقل المفرد)",
  },
  {
    key: "dlc",
    type: "object",
    target: "dlc",
    repeatable: true,
    itemFields: {
      title: { key: "title", type: "string", target: "name" },
      description: { key: "description", type: "multiline", target: "description" },
      image: { key: "image", type: "url", target: "coverUrl" },
      release_date: { key: "release_date", type: "string", target: "releaseDate" },
    },
    description: "الإضافات",
  },

  // GUIDES
  {
    key: "guide",
    type: "object",
    target: "guides",
    repeatable: true,
    itemFields: {
      title: { key: "title", type: "string", target: "title" },
      summary: { key: "summary", type: "multiline", target: "summary" },
      url: { key: "url", type: "url", target: "url" },
    },
    description: "الأدلة",
  },

  // COMPLETION
  {
    key: "completion_main_story_hours",
    type: "number",
    target: "completionMain",
    description: "القصة الرئيسية (ساعة)",
  },
  {
    key: "completion_story_plus_dlc_hours",
    type: "number",
    target: "completionExtras",
    description: "القصة + الإضافات (ساعة)",
  },
  {
    key: "completion_100_percent_hours",
    type: "number",
    target: "completionAll",
    description: "إكمال 100% (ساعة)",
  },

  // FAQ
  {
    key: "faq",
    type: "object",
    target: "faq",
    repeatable: true,
    itemFields: {
      question: { key: "question", type: "string", target: "q" },
      answer: { key: "answer", type: "multiline", target: "a" },
    },
    description: "الأسئلة الشائعة",
  },

  // VERDICT
  {
    key: "verdict_score",
    type: "number",
    target: "verdictScore",
    description: "الحكم النهائي من 10",
  },
  { key: "verdict_summary", type: "multiline", target: "verdictSummary", description: "الخلاصة" },
  {
    key: "verdict_pro",
    type: "object",
    target: "verdictPros",
    repeatable: true,
    itemFields: { value: { key: "value", type: "string", target: "value" } },
    description: "الإيجابيات",
  },
  {
    key: "verdict_con",
    type: "object",
    target: "verdictCons",
    repeatable: true,
    itemFields: { value: { key: "value", type: "string", target: "value" } },
    description: "السلبيات",
  },

  // REVIEWS
  {
    key: "review",
    type: "object",
    target: "reviews",
    repeatable: true,
    itemFields: {
      source: { key: "source", type: "string", target: "source" },
      score: { key: "score", type: "string", target: "score" },
      quote: { key: "quote", type: "multiline", target: "quote" },
      url: { key: "url", type: "url", target: "url" },
    },
    description: "مراجعات مختارة",
  },

  // TIMELINE
  {
    key: "timeline",
    type: "object",
    target: "timeline",
    repeatable: true,
    itemFields: {
      date: { key: "date", type: "string", target: "date" },
      title: { key: "title", type: "string", target: "title" },
      details: { key: "details", type: "multiline", target: "body" },
    },
    description: "الخط الزمني",
  },

  // UPDATES
  {
    key: "update",
    type: "object",
    target: "patchNotes",
    repeatable: true,
    itemFields: {
      version: { key: "version", type: "string", target: "version" },
      date: { key: "date", type: "string", target: "date" },
      changes: { key: "changes", type: "multiline", target: "body" },
    },
    description: "التحديثات",
  },

  // MUSIC
  {
    key: "music",
    type: "object",
    target: "soundtrack",
    repeatable: true,
    itemFields: {
      title: { key: "title", type: "string", target: "title" },
      url: { key: "url", type: "url", target: "url" },
    },
    description: "الموسيقى",
  },

  // SERIES
  { key: "series_name", type: "string", target: "seriesName", description: "اسم السلسلة" },
  {
    key: "series_game",
    type: "object",
    target: "seriesEntries",
    repeatable: true,
    itemFields: { value: { key: "value", type: "string", target: "value" } },
    description: "أجزاء السلسلة (ألعاب مشابهة)",
  },

  // STUDIO
  { key: "studio_name", type: "string", target: "studioName", description: "اسم الاستوديو" },
  { key: "studio_website", type: "url", target: "studioUrl", description: "موقع الاستوديو" },
  {
    key: "studio_location",
    type: "string",
    target: "studioLocation",
    description: "مقر الاستوديو",
  },
  {
    key: "studio_description",
    type: "multiline",
    target: "studioAbout",
    description: "عن الاستوديو",
  },

  // SETTINGS
  {
    key: "setting_requirement",
    type: "object",
    target: "setupNeeds",
    repeatable: true,
    itemFields: { value: { key: "value", type: "string", target: "value" } },
    description: "المتطلبات",
  },

  // SOURCES
  {
    key: "source",
    type: "object",
    target: "sources",
    repeatable: true,
    itemFields: {
      name: { key: "name", type: "string", target: "name" },
      url: { key: "url", type: "url", target: "url" },
    },
    description: "المصادر",
  },

  // OPTIONS
  {
    key: "option",
    type: "object",
    target: "options",
    repeatable: true,
    templateRepeat: 2,
    itemFields: {
      id: { key: "id", type: "string", target: "id" },
      name: { key: "name", type: "string", target: "name" },
      /** Customer-facing. Pricing rules and supplier notes do not belong here. */
      description: {
        key: "description",
        type: "string",
        target: "description",
        description: "وصف يراه الزبون فقط. لا تكتب هنا قواعد تسعير أو مصادر أو تحويل عملة",
      },
      /** Admin-only. Never serialised to the storefront. */
      internal_note: {
        key: "internal_note",
        type: "string",
        target: "internalNote",
        description: "ملاحظة داخلية للإدارة فقط — لا تظهر للزبون إطلاقاً",
      },
      stock: { key: "stock", type: "number", target: "stock" },
      is_infinite_stock: {
        key: "is_infinite_stock",
        type: "boolean",
        target: "isInfiniteStock",
        defaultValue: true,
      },
    },
    description:
      "خيارات المنتج الرئيسية — لكل لعبة خياران: option.1.id=offline_account (حساب أوفلاين) و option.2.id=online_account (حساب أونلاين)",
  },

  // TYPES
  {
    key: "type",
    type: "object",
    target: "types",
    repeatable: true,
    templateRepeat: 4,
    itemFields: {
      id: { key: "id", type: "string", target: "id" },
      name: { key: "name", type: "string", target: "name" },
      option_id: { key: "option_id", type: "string", target: "optionId" },
      price: { key: "price", type: "number", target: "price" },
      cost: { key: "cost", type: "number", target: "cost" },
      /*
        Customer-facing. This field sat directly under `cost` with no guidance
        and extraction runs filled it with the supplier conversion rule — which
        the editions comparison then printed next to the price, in front of
        buyers. Say who it is for.
      */
      description: {
        key: "description",
        type: "string",
        target: "description",
        description:
          "وصف يراه الزبون فقط (مثال: «يدعم اللعب أونلاين»). لا تكتب هنا أي قاعدة تسعير أو مصدر أو تحويل عملة",
      },
      /** Admin-only. Never serialised to the storefront. */
      internal_note: {
        key: "internal_note",
        type: "string",
        target: "internalNote",
        description:
          "ملاحظة داخلية للإدارة فقط — قواعد المورّد وتحويل العملة والتقريب. لا تظهر للزبون إطلاقاً",
      },
      stock: { key: "stock", type: "number", target: "stock" },
      is_infinite_stock: {
        key: "is_infinite_stock",
        type: "boolean",
        target: "isInfiniteStock",
        defaultValue: true,
      },
    },
    description:
      "أنواع المنتج المرتبطة بالخيارات — النسخة القياسية لكل خيار (standard_offline / standard_online)، وعند وجود DLC حقيقي فقط تُضاف dlc_offline / dlc_online بسعرها الجاهز من الملف",
  },
];
