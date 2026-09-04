/**
 * Editable site content stored inside the store document under `content`.
 * Admin dashboard saves it through the existing /api/content pipe, and served
 * publicly through /api/content or server functions.
 */

export interface FaqCategory {
  id: string;
  name_ar: string;
  name_en?: string;
  name_tr?: string;
  sort_order: number;
  published: boolean;
}

export interface FaqItem {
  id: string;
  category_id: string;
  /*
    Where the full explanation lives.

    The answers here are deliberately short — three sentences a customer reads
    on a phone. Anything longer belongs in the guide or the policy clause that
    owns it, and this is the link to it. Without it the FAQ either repeats
    those pages, which then drift apart, or stops short of the answer.
  */
  more_href?: string;
  question_ar: string;
  question_en?: string;
  question_tr?: string;
  answer_ar: string;
  answer_en?: string;
  answer_tr?: string;
  keywords: string;
  sort_order: number;
  featured: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface PolicySection {
  id: string;
  /** Stable URL fragment, so an order card can link straight to a clause. */
  anchor?: string;
  images?: ContentImage[];
  /*
    One sentence for the summary at the top of the page.

    A policy nobody reads protects nobody. The clauses that decide whether
    somebody keeps their game — do not delete the user, no refund after the
    account is sent — have to be readable before the reader gives up, and the
    full text is a click away under the same anchor.
  */
  summary_ar?: string;
  summary_en?: string;
  title_ar: string;
  title_en?: string;
  title_tr?: string;
  body_ar: string;
  body_en?: string;
  body_tr?: string;
  icon?: string;
  sort_order: number;
  highlight: boolean;
}

export interface PolicyData {
  title_ar: string;
  title_en?: string;
  title_tr?: string;
  subtitle_ar: string;
  subtitle_en?: string;
  subtitle_tr?: string;
  version: string;
  effective_date: string;
  last_updated: string;
  important_notices: string;
  contact_note: string;
  sections: PolicySection[];
}

export interface SupportService {
  id: string;
  title_ar: string;
  title_en?: string;
  title_tr?: string;
  description_ar: string;
  description_en?: string;
  description_tr?: string;
  icon?: string;
  link?: string;
  button_label_ar?: string;
  button_label_en?: string;
  button_label_tr?: string;
  sort_order: number;
  active: boolean;
}

export interface SupportChannel {
  id: string;
  type: string;
  label_ar: string;
  label_en?: string;
  label_tr?: string;
  value: string;
  href: string;
  icon?: string;
  availability?: string;
  sort_order: number;
  active: boolean;
}

export interface SupportData {
  hero_title_ar: string;
  hero_title_en?: string;
  hero_title_tr?: string;
  hero_subtitle_ar: string;
  hero_subtitle_en?: string;
  hero_subtitle_tr?: string;
  support_intro_ar: string;
  support_intro_en?: string;
  support_intro_tr?: string;
  email: string;
  phone: string;
  whatsapp: string;
  telegram: string;
  chat_link: string;
  status_message_ar: string;
  status_message_en?: string;
  status_message_tr?: string;
  emergency_notice_ar?: string;
  emergency_notice_en?: string;
  emergency_notice_tr?: string;
  working_hours_ar: string;
  working_hours_en?: string;
  working_hours_tr?: string;
  services: SupportService[];
  channels: SupportChannel[];
}

/**
 * One picture in an admin-managed slot.
 *
 * A slot exists before its picture does. `url` is empty until the shop owner
 * uploads one, and that empty state is the point: the admin screen renders a
 * dashed box captioned with `hint` — "أضف صورة الخطوة ١ — فتح Nintendo eShop" —
 * so it is obvious what is missing, while the public page renders nothing at
 * all. Not a placeholder, not a broken image, not a gap where a figure would
 * be: the element is absent.
 *
 * `hint` is written for whoever uploads and is never shown to a customer.
 * `alt` is written for whoever cannot see the picture and always is.
 */
export interface ContentImage {
  id: string;
  /** Empty while the slot is waiting to be filled. */
  url: string;
  /** Admin-facing: which picture belongs here. Never rendered publicly. */
  hint?: string;
  alt: string;
  alt_en?: string;
  caption?: string;
  caption_en?: string;
  sort_order: number;
}

/**
 * Every filled picture of a slot list, in order.
 *
 * Two things at once: it drops the empty slots, which is what keeps a
 * half-finished guide from showing holes to a customer, and it folds in the
 * single `image` field the older shape used so no picture already uploaded is
 * lost when a step gains a gallery.
 */
export function filledImages(
  images: ContentImage[] | undefined,
  legacy?: string,
  legacyAlt?: string,
): ContentImage[] {
  const list = (images ?? []).filter((image) => Boolean(image?.url?.trim()));
  if (list.length === 0 && legacy?.trim()) {
    return [{ id: "legacy", url: legacy.trim(), alt: legacyAlt ?? "", sort_order: 0 }];
  }
  return [...list].sort((a, b) => a.sort_order - b.sort_order);
}

export interface GuideStep {
  id: string;
  title_ar: string;
  title_en?: string;
  title_tr?: string;
  description_ar: string;
  description_en?: string;
  description_tr?: string;
  /** Legacy single picture. `images` supersedes it; both are read. */
  image?: string;
  /** Ordered slots, filled and empty. */
  images?: ContentImage[];
  video?: string;
  note_ar?: string;
  note_en?: string;
  note_tr?: string;
  warning_ar?: string;
  warning_en?: string;
  warning_tr?: string;
  sort_order: number;
}

export interface GuideItem {
  id: string;
  /** Also the URL fragment: `/account_guides#<slug>`. */
  slug: string;
  title_ar: string;
  title_en?: string;
  title_tr?: string;
  description_ar: string;
  description_en?: string;
  description_tr?: string;
  category: string;
  cover_image?: string;
  video_url?: string;
  estimated_time?: string;
  difficulty?: string;
  sort_order: number;
  published: boolean;
  /*
    A note or a warning that belongs to the whole guide rather than to one of
    its steps — "the code is valid for one hour", "never delete the game
    account user". Printing those inside a single step buries the one sentence
    that decides whether somebody loses their game.
  */
  note_ar?: string;
  note_en?: string;
  warning_ar?: string;
  warning_en?: string;
  steps: GuideStep[];
}

/* ------------------------------------------------------------------ *
 * Shared building blocks for the editable service pages
 * ------------------------------------------------------------------ */

/** A safe, admin-managed option for a select / choice control. */
export interface SelectOption {
  value: string;
  label_ar: string;
  label_en?: string;
  label_tr?: string;
  description_ar?: string;
  active: boolean;
  sort_order: number;
}

/** A numbered "how it works" step. */
export interface ServiceStep {
  id: string;
  title_ar: string;
  title_en?: string;
  title_tr?: string;
  description_ar: string;
  description_en?: string;
  description_tr?: string;
  icon?: string;
  sort_order: number;
}

/** A short trust / reassurance chip. */
export interface ServiceFeature {
  id: string;
  label_ar: string;
  label_en?: string;
  label_tr?: string;
  icon?: string;
  sort_order: number;
}

/** Admin-authored copy for a single lifecycle status. */
export interface StatusContent {
  status: string;
  title_ar: string;
  title_en?: string;
  title_tr?: string;
  description_ar: string;
  description_en?: string;
  description_tr?: string;
}

export interface FaqBlock {
  id: string;
  question_ar: string;
  answer_ar: string;
  sort_order: number;
}

export interface AddGameData {
  /** Legacy fields, still rendered as helper copy. */
  intro_ar: string;
  intro_en?: string;
  intro_tr?: string;
  note_ar: string;
  note_en?: string;
  note_tr?: string;

  enabled: boolean;

  hero_badge_ar: string;
  hero_badge_en?: string;
  hero_badge_tr?: string;
  hero_title_ar: string;
  hero_title_en?: string;
  hero_title_tr?: string;
  hero_subtitle_ar: string;
  hero_subtitle_en?: string;
  hero_subtitle_tr?: string;
  hero_image_url?: string;

  search_title_ar: string;
  search_placeholder_ar: string;

  available_title_ar: string;
  available_description_ar: string;

  catalog_match_title_ar: string;
  catalog_match_description_ar: string;

  not_found_title_ar: string;
  not_found_description_ar: string;
  manual_request_cta_ar: string;

  how_it_works_title_ar: string;
  how_it_works: ServiceStep[];
  trust_items: ServiceFeature[];

  allowed_request_types: SelectOption[];
  platforms: SelectOption[];
  versions: SelectOption[];
  regions: SelectOption[];
  contact_methods: SelectOption[];

  form_title_ar: string;
  form_helper_ar: string;
  review_title_ar: string;
  submit_button_ar: string;

  success_title_ar: string;
  success_description_ar: string;

  history_title_ar: string;
  history_empty_title_ar: string;
  history_empty_description_ar: string;

  status_content: StatusContent[];

  login_gate_title_ar: string;
  login_gate_description_ar: string;

  footer_note_ar?: string;

  section_order: string[];
  section_visibility: Record<string, boolean>;

  seo_title_ar?: string;
  seo_description_ar?: string;
}

export interface DiscTradeData {
  enabled: boolean;

  hero_badge_ar: string;
  hero_title_ar: string;
  hero_subtitle_ar: string;
  hero_image_url?: string;

  trust_items: ServiceFeature[];
  steps: ServiceStep[];

  search_title_ar: string;
  search_placeholder_ar: string;

  no_game_title_ar: string;
  no_game_description_ar: string;

  manual_entry_title_ar: string;
  manual_entry_description_ar: string;

  condition_title_ar: string;
  condition_description_ar: string;
  condition_category_content: Record<
    string,
    { title_ar?: string; description_ar?: string; icon?: string }
  >;

  photos_title_ar: string;
  photos_description_ar: string;
  photos_max: number;
  photos_required: boolean;

  offer_title_ar: string;
  cash_title_ar: string;
  cash_description_ar: string;
  store_credit_title_ar: string;
  store_credit_description_ar: string;
  payout_options: SelectOption[];

  valuation_notice_ar: string;
  policy_checkbox_ar: string;
  submit_button_ar: string;

  success_title_ar: string;
  success_description_ar: string;

  history_title_ar: string;
  history_empty_title_ar: string;
  history_empty_description_ar: string;

  status_content: StatusContent[];

  login_gate_title_ar: string;
  login_gate_description_ar: string;

  page_faq?: FaqBlock[];

  section_order: string[];
  section_visibility: Record<string, boolean>;

  seo_title_ar?: string;
  seo_description_ar?: string;
}

/** Admin-authored troubleshooting entry shown on /problem. */
export interface ProblemEntry {
  id: string;
  emoji?: string;
  title: string;
  description: string;
  category: string;
  cause?: string;
  keywords?: string[];
  /** Legacy single picture. `images` supersedes it; both are read. */
  imageUrl?: string;
  /** Ordered slots for the problem itself — the error screen, usually. */
  images?: ContentImage[];
  /*
    A step carries its own slots. The screen a customer is looking at changes
    at every step of a fix, and one picture for the whole problem cannot show
    both the button to press and the dialog it opens.
  */
  steps?: { title: string; description: string; images?: ContentImage[] }[];
  /** What the customer must not do — the part that loses an account. */
  avoid?: string[];
  /** When to stop and ask a person instead. */
  contactAdminWhen?: string;
  /** Error codes a customer may literally type into the search box. */
  errorCodes?: string[];
  published?: boolean;
}

export interface ContentDoc {
  problems?: ProblemEntry[];
  faqCategories: FaqCategory[];
  faq: FaqItem[];
  policy: PolicyData;
  tradePolicy: PolicyData;
  support: SupportData;
  addGame: AddGameData;
  discTrade: DiscTradeData;
  guides: GuideItem[];
}

const opt = (
  value: string,
  label_ar: string,
  sort_order: number,
  description_ar?: string,
): SelectOption => ({
  value,
  label_ar,
  active: true,
  sort_order,
  ...(description_ar ? { description_ar } : {}),
});

export const DEFAULT_CONTENT: ContentDoc = {
  problems: [],
  faqCategories: [],
  faq: [],
  policy: {
    title_ar: "سياسة المتجر",
    subtitle_ar: "الشروط والأحكام المتعلقة بالشراء والاسترجاع",
    version: "1.0",
    effective_date: "",
    last_updated: "",
    important_notices: "",
    contact_note: "",
    sections: [],
  },
  tradePolicy: {
    title_ar: "سياسة المقايضة",
    subtitle_ar: "الشروط والأحكام المتعلقة باستبدال وتقييم الأقراص",
    version: "1.0",
    effective_date: "",
    last_updated: "",
    important_notices: "",
    contact_note: "",
    sections: [],
  },
  support: {
    hero_title_ar: "مركز الدعم والمساعدة",
    hero_subtitle_ar: "نحن هنا لمساعدتك",
    support_intro_ar: "فريق بنانا ستور معك في كل خطوة",
    email: "",
    phone: "",
    whatsapp: "",
    telegram: "",
    chat_link: "/chat",
    status_message_ar: "فريق الدعم متاح الآن",
    working_hours_ar: "١٠ صباحاً - ١٠ مساءً",
    services: [],
    channels: [],
  },
  addGame: {
    intro_ar: "لم تجد اللعبة التي تبحث عنها؟ أرسل لنا تفاصيلها وسنعمل على توفيرها لك.",
    note_ar: "نراجع الطلبات يومياً ونرد خلال ٢٤ إلى ٧٢ ساعة.",
    enabled: true,
    hero_badge_ar: "طلب خاص",
    hero_title_ar: "ما لقيت لعبتك؟ خلّها علينا 🎮",
    hero_subtitle_ar:
      "ابحث عن اللعبة أولاً. إذا كانت موجودة نوصلك إليها مباشرة، وإذا لم تكن متوفرة أرسل طلب توفيرها وسنتابعها لك.",
    search_title_ar: "ابحث عن اللعبة",
    search_placeholder_ar: "اكتب اسم اللعبة… مثال: Mario Party Jamboree",
    available_title_ar: "ممتاز! اللعبة متوفرة عندنا حالياً.",
    available_description_ar: "تقدر تشتريها الآن مباشرة من صفحة المنتج.",
    catalog_match_title_ar: "نعرف هذه اللعبة، لكنها غير متوفرة للبيع حالياً",
    catalog_match_description_ar: "اطلب توفيرها وسنتابع لك الموضوع خطوة بخطوة.",
    not_found_title_ar: "ما لقيناها؟ مو مشكلة.",
    not_found_description_ar: "أرسل لنا اسم اللعبة أو رابطها وسنبحث عنها يدوياً.",
    manual_request_cta_ar: "إضافة اللعبة يدوياً",
    how_it_works_title_ar: "كيف تعمل الخدمة؟",
    how_it_works: [
      {
        id: "step1",
        title_ar: "ابحث",
        description_ar: "نتأكد أولاً إن كانت اللعبة متوفرة بالفعل.",
        sort_order: 1,
      },
      {
        id: "step2",
        title_ar: "أرسل المواصفات",
        description_ar: "حدد الجهاز والنسخة والمنطقة التي تريدها.",
        sort_order: 2,
      },
      {
        id: "step3",
        title_ar: "تابع الطلب",
        description_ar: "نحدث حالة الطلب حتى تصبح اللعبة متوفرة.",
        sort_order: 3,
      },
    ],
    trust_items: [
      { id: "t1", label_ar: "بحث مباشر في متجرنا", sort_order: 1 },
      { id: "t2", label_ar: "متابعة حالة الطلب", sort_order: 2 },
      { id: "t3", label_ar: "طلبات التوفير تُراجع باستمرار", sort_order: 3 },
    ],
    allowed_request_types: [opt("game", "لعبة", 1)],
    platforms: [
      opt("switch2", "Nintendo Switch 2", 1),
      opt("switch", "Nintendo Switch", 2),
      opt("both", "تعمل على Switch وSwitch 2", 3),
      opt("other", "أخرى", 4),
    ],
    versions: [
      opt("any", "لا يهم", 1),
      opt("digital", "رقمية", 2),
      opt("physical", "فيزيائية", 3),
      opt("standard", "Standard", 4),
      opt("deluxe", "Deluxe", 5),
      opt("collector", "Collector’s Edition", 6),
      opt("other", "أخرى", 7),
    ],
    regions: [
      opt("any", "لا يهم", 1),
      opt("usa", "USA", 2),
      opt("europe", "Europe", 3),
      opt("japan", "Japan", 4),
      opt("asia", "Asia", 5),
      opt("gcc", "GCC / Middle East", 6),
      opt("other", "أخرى", 7),
    ],
    contact_methods: [
      opt("site", "داخل الموقع", 1),
      opt("telegram", "Telegram", 2),
      opt("phone", "الهاتف", 3),
    ],
    form_title_ar: "المواصفات المطلوبة",
    form_helper_ar: "كل التفاصيل اختيارية، لكنها تساعدنا نوصلك النسخة الصحيحة.",
    review_title_ar: "مراجعة الطلب",
    submit_button_ar: "إرسال طلب التوفير",
    success_title_ar: "وصلنا طلبك 🎮",
    success_description_ar: "بدأنا متابعة اللعبة، وستظهر أي تحديثات هنا وفي حسابك.",
    history_title_ar: "طلباتي السابقة",
    history_empty_title_ar: "أول طلب ينتظرك",
    history_empty_description_ar: "إذا لم تجد لعبة في المتجر، اطلبها وسنحتفظ بكل التحديثات هنا.",
    status_content: [
      {
        status: "submitted",
        title_ar: "تم استلام الطلب",
        description_ar: "وصل طلبك إلى النظام.",
      },
      {
        status: "under_review",
        title_ar: "قيد المراجعة",
        description_ar: "نتحقق من اللعبة والنسخة المطلوبة.",
      },
      {
        status: "accepted",
        title_ar: "تم قبول الطلب",
        description_ar: "اعتمدنا طلب التوفير.",
      },
      {
        status: "sourcing",
        title_ar: "جارٍ البحث عن توفر",
        description_ar: "نعمل على العثور على مصدر أو نسخة مناسبة.",
      },
      {
        status: "available",
        title_ar: "أصبحت متوفرة",
        description_ar: "وجدنا اللعبة وأصبحت جاهزة للمتابعة.",
      },
      {
        status: "added",
        title_ar: "تمت إضافتها للمتجر",
        description_ar: "اللعبة أصبحت متوفرة للشراء.",
      },
      {
        status: "rejected",
        title_ar: "تعذر توفير اللعبة",
        description_ar: "راجع ملاحظة الإدارة أدناه.",
      },
      { status: "cancelled", title_ar: "تم إلغاء الطلب", description_ar: "" },
    ],
    login_gate_title_ar: "سجّل دخولك لإرسال الطلب",
    login_gate_description_ar: "سجّل دخولك حتى نحفظ طلبك ونبلغك عندما تتوفر اللعبة.",
    footer_note_ar: "لن يتم احتساب أي مبلغ الآن. سنبلغك عند توفر اللعبة أو وجود تحديث على الطلب.",
    section_order: ["hero", "search", "how_it_works", "history"],
    section_visibility: { hero: true, search: true, how_it_works: true, history: true },
    seo_title_ar: "طلب إضافة لعبة — بنانتو",
    seo_description_ar: "ابحث عن لعبتك، وإذا لم تكن متوفرة أرسل طلب توفيرها وتابع حالته.",
  },
  discTrade: {
    enabled: true,
    hero_badge_ar: "Trade-in",
    hero_title_ar: "لعبتك القديمة لسه إلها قيمة 🎮",
    hero_subtitle_ar: "ابحث عن لعبتك، قيّم حالتها وشاهد قيمة الاستبدال المتوقعة مباشرة.",
    trust_items: [
      { id: "t1", label_ar: "تقييم واضح", sort_order: 1 },
      { id: "t2", label_ar: "حساب فوري للألعاب المسعّرة", sort_order: 2 },
      { id: "t3", label_ar: "القيمة النهائية بعد الفحص", sort_order: 3 },
    ],
    steps: [
      { id: "s1", title_ar: "اختر اللعبة", description_ar: "", sort_order: 1 },
      { id: "s2", title_ar: "حدد حالتها", description_ar: "", sort_order: 2 },
      { id: "s3", title_ar: "ارفع الصور", description_ar: "", sort_order: 3 },
      { id: "s4", title_ar: "شاهد العرض", description_ar: "", sort_order: 4 },
    ],
    search_title_ar: "اختر لعبتك",
    search_placeholder_ar: "ابحث باسم اللعبة التي تريد استبدالها...",
    no_game_title_ar: "لعبتي غير موجودة",
    no_game_description_ar: "سنراجع اللعبة يدوياً ونرسل لك التقييم بعد فحص الطلب.",
    manual_entry_title_ar: "إدخال يدوي",
    manual_entry_description_ar: "اكتب اسم اللعبة والمنصة وسنراجعها بأنفسنا.",
    condition_title_ar: "تقييم الحالة",
    condition_description_ar: "اختر ما ينطبق على نسختك، ويتحدث التقييم مباشرة.",
    condition_category_content: {},
    photos_title_ar: "صور اللعبة",
    photos_description_ar: "الصور الواضحة تساعدنا على تأكيد السعر بسرعة أكبر.",
    photos_max: 5,
    photos_required: false,
    offer_title_ar: "قيمة الاستبدال",
    cash_title_ar: "نقداً",
    cash_description_ar: "تستلم القيمة النقدية المعتمدة وفق طريقة التسليم المتاحة.",
    store_credit_title_ar: "رصيد المتجر",
    store_credit_description_ar: "يضاف المبلغ المعتمد إلى رصيد حسابك بعد إكمال الفحص.",
    payout_options: [
      opt("store_credit", "رصيد المتجر", 1, "يضاف المبلغ المعتمد إلى رصيد حسابك بعد الفحص."),
      opt("cash", "نقداً", 2, "تستلم القيمة النقدية المعتمدة وفق طريقة التسليم المتاحة."),
    ],
    valuation_notice_ar:
      "هذا تقييم مبدئي يعتمد على المعلومات التي أدخلتها. يتم اعتماد القيمة النهائية بعد فحص اللعبة فعلياً.",
    policy_checkbox_ar: "قرأت شروط الاستبدال وأوافق عليها",
    submit_button_ar: "إرسال طلب الاستبدال",
    success_title_ar: "تم إرسال طلب الاستبدال بنجاح 🎉",
    success_description_ar: "حفظنا تفاصيل لعبتك وسنراجع التقييم قبل الخطوة التالية.",
    history_title_ar: "مقايضاتي السابقة",
    history_empty_title_ar: "لا توجد مقايضات بعد",
    history_empty_description_ar: "ابدأ بتقييم لعبتك الأولى وسيظهر سجل الطلبات هنا.",
    status_content: [
      // One entry per state in the current lifecycle, in order. The previous
      // list carried three payout synonyms and two review states, so a customer
      // could see "بانتظار المراجعة" twice with no idea which was which.
      {
        status: "awaiting_pricing",
        title_ar: "بانتظار التسعير",
        description_ar: "وصل طلبك، وفريقنا يحدد السعر يدوياً لهذه اللعبة.",
      },
      {
        status: "priced",
        title_ar: "تم التسعير",
        description_ar: "تم تحديد السعر ونراجعه قبل إرسال العرض إليك.",
      },
      {
        status: "awaiting_customer_approval",
        title_ar: "بانتظار موافقتك",
        description_ar: "العرض جاهز — راجع السعر النهائي ووافق للمتابعة.",
      },
      {
        status: "customer_approved",
        title_ar: "تمت الموافقة",
        description_ar: "شكراً لك، سنبدأ بترتيب استلام اللعبة.",
      },
      {
        status: "awaiting_receipt",
        title_ar: "بانتظار الاستلام",
        description_ar: "ننتظر وصول اللعبة إلينا.",
      },
      {
        status: "inspecting",
        title_ar: "قيد الفحص",
        description_ar: "نفحص القرص أو الشريحة والعلبة والحالة الفعلية.",
      },
      { status: "completed", title_ar: "مكتملة", description_ar: "اكتملت عملية الاستبدال بنجاح." },
      {
        status: "rejected",
        title_ar: "تعذر قبول المقايضة",
        description_ar: "راجع ملاحظة الإدارة أدناه.",
      },
      { status: "cancelled", title_ar: "ملغاة", description_ar: "" },
    ],
    login_gate_title_ar: "سجّل دخولك لحفظ التقييم",
    login_gate_description_ar: "سجّل دخولك لحفظ التقييم ومتابعة حالة الاستبدال.",
    page_faq: [],
    section_order: ["hero", "steps", "wizard", "history"],
    section_visibility: { hero: true, steps: true, wizard: true, history: true },
    seo_title_ar: "استبدال الأقراص — بنانتو",
    seo_description_ar: "قيّم لعبتك المستعملة واحصل على قيمة استبدال نقداً أو رصيد متجر.",
  },
  guides: [],
};

/** Fills any missing/emptied section with the shipped defaults. */
export function mergeContent(partial: unknown): ContentDoc {
  const source = (partial ?? {}) as Partial<ContentDoc>;
  return {
    problems: Array.isArray(source.problems) ? source.problems : DEFAULT_CONTENT.problems,
    faqCategories: Array.isArray(source.faqCategories)
      ? source.faqCategories
      : DEFAULT_CONTENT.faqCategories,
    faq: Array.isArray(source.faq) ? source.faq : DEFAULT_CONTENT.faq,
    policy: source.policy
      ? { ...DEFAULT_CONTENT.policy, ...source.policy }
      : DEFAULT_CONTENT.policy,
    tradePolicy: source.tradePolicy
      ? { ...DEFAULT_CONTENT.tradePolicy, ...source.tradePolicy }
      : DEFAULT_CONTENT.tradePolicy,
    support: source.support
      ? { ...DEFAULT_CONTENT.support, ...source.support }
      : DEFAULT_CONTENT.support,
    addGame: source.addGame
      ? { ...DEFAULT_CONTENT.addGame, ...source.addGame }
      : DEFAULT_CONTENT.addGame,
    discTrade: source.discTrade
      ? { ...DEFAULT_CONTENT.discTrade, ...source.discTrade }
      : DEFAULT_CONTENT.discTrade,
    guides: Array.isArray(source.guides) ? source.guides : DEFAULT_CONTENT.guides,
  };
}

/** Picks the localized variant of a field with an Arabic fallback. */
export function localized(
  obj: Record<string, unknown> | undefined | null,
  key: string,
  lang = "ar",
): string {
  if (!obj) return "";
  return String(obj[`${key}_${lang}`] || obj[`${key}_ar`] || "");
}

/** Active options sorted for rendering. */
export function activeOptions(options: SelectOption[] | undefined): SelectOption[] {
  return (options ?? [])
    .filter((o) => o?.active !== false)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Only http(s) links are ever rendered or stored from admin/user input. */
export function safeHttpUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://banan.to");
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return raw.startsWith("/") ? raw : url.toString();
  } catch {
    return "";
  }
}

/** Status copy lookup with a graceful fallback. */
export function statusCopy(
  list: StatusContent[] | undefined,
  status: string,
  lang = "ar",
): { title: string; description: string } {
  const found = (list ?? []).find((s) => s.status === status);
  return {
    title: found ? localized(found as unknown as Record<string, unknown>, "title", lang) : status,
    description: found
      ? localized(found as unknown as Record<string, unknown>, "description", lang)
      : "",
  };
}
