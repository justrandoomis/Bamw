/**
 * Multilingual Support Engine & Reply Generation.
 *
 * Fully supports Arabic (ar), English (en), Kurdish (ku), and Turkish (tr).
 * When AI response is provided by the Gemini understand layer, it preserves
 * the generated text and renders rich interactive cards.
 * When in offline/deterministic mode, it generates pristine localized templates.
 */

import { detect, findProducts, type Detection } from "./intent";
import { BUILTIN_ARTICLES } from "./kb";
import { INTENT_PHRASES } from "./lexicon";
import { detectSensitive, sensitiveReply } from "./sensitive";
import { detectLang, matchAny, norm, surfaces } from "./normalize";
import {
  emptyMemory,
  type KbArticle,
  type SafeOrder,
  type SafeProduct,
  type SupportCard,
  type SupportContext,
  type SupportIntent,
  type SupportLang,
  type SupportMemory,
  type SupportReply,
} from "./types";
import type { SupportHint } from "./understand.server";
import { isUnderMaintenance } from "../maintenance";

/**
 * `pending` is an order that has not been prepared yet — it says nothing about
 * payment, so the wording has to come from the payment status as well. Calling
 * it "awaiting payment" is what made a wallet purchase report both "بانتظار
 * الدفع" and "مدفوع" in the same line.
 */
export function orderStatusLabel(
  status: string,
  paymentStatus: string | undefined,
  lang: SupportLang,
): string {
  const table = STATUS_I18N[lang] ?? STATUS_I18N.ar;
  if (status === "pending" && paymentStatus === "paid") {
    return table["processing"] ?? status;
  }
  return table[status] ?? status;
}

const STATUS_I18N: Record<SupportLang, Record<string, string>> = {
  ar: {
    pending: "بانتظار الدفع",
    processing: "قيد التجهيز",
    delivering: "قيد التسليم",
    completed: "مكتمل",
    cancelled: "ملغى",
  },
  en: {
    pending: "Pending Payment",
    processing: "Processing",
    delivering: "Out for Delivery",
    completed: "Completed",
    cancelled: "Cancelled",
  },
  ku: {
    pending: "Li benda dravdanê",
    processing: "Tê amadekirin",
    delivering: "Di rê de ye",
    completed: "Temam bû",
    cancelled: "Betal bû",
  },
  tr: {
    pending: "Ödeme Bekleniyor",
    processing: "Hazırlanıyor",
    delivering: "Teslimatta",
    completed: "Tamamlandı",
    cancelled: "İptal Edildi",
  },
};

const PAYMENT_I18N: Record<SupportLang, Record<string, string>> = {
  ar: {
    unpaid: "لم يتم الدفع",
    review: "قيد مراجعة الوصل",
    paid: "مدفوع",
    rejected: "الوصل مرفوض",
  },
  en: {
    unpaid: "Unpaid",
    review: "Receipt under review",
    paid: "Paid",
    rejected: "Receipt rejected",
  },
  ku: {
    unpaid: "Nehatiye dayîn",
    review: "Wergirtin tê kontrolkirin",
    paid: "Hat dayîn",
    rejected: "Wergirtin nehat qebûlkirin",
  },
  tr: {
    unpaid: "Ödenmedi",
    review: "Dekont inceleniyor",
    paid: "Ödendi",
    rejected: "Dekont reddedildi",
  },
};

const SUGGESTIONS_I18N: Record<
  SupportLang,
  { default: string[]; greeting: string[]; support: string; browse: string }
> = {
  ar: {
    default: ["تصفح الألعاب", "أحدث الإكسسوارات", "تحدث مع الدعم"],
    greeting: ["حالة طلبي", "طرق الدفع", "أحدث الإكسسوارات"],
    support: "تحدث مع الدعم",
    browse: "تصفح الألعاب",
  },
  en: {
    default: ["Browse Games", "Latest Accessories", "Talk to Support"],
    greeting: ["Order Status", "Payment Methods", "Latest Accessories"],
    support: "Talk to Support",
    browse: "Browse Games",
  },
  ku: {
    default: ["Li lîstikan bigere", "Aksesorên nû", "Bi piştgiriyê re biaxive"],
    greeting: ["Rewşa siparîşê", "Rêyên dravdanê", "Aksesorên nû"],
    support: "Bi piştgiriyê re biaxive",
    browse: "Li lîstikan bigere",
  },
  tr: {
    default: ["Oyunlara Göz At", "En Yeni Aksesuarlar", "Destekle Görüş"],
    greeting: ["Sipariş Durumu", "Ödeme Yöntemleri", "En Yeni Aksesuarlar"],
    support: "Destekle Görüş",
    browse: "Oyunlara Göz At",
  },
};

const money = (value: number, symbol: string) =>
  `${Math.round(value).toLocaleString("en-US")} ${symbol}`;

function productCard(product: SafeProduct, symbol: string, lang: SupportLang): SupportCard {
  const isEn = lang === "en";
  const isKu = lang === "ku";
  const isTr = lang === "tr";

  const priceText =
    product.price > 0
      ? isEn
        ? `Price: ${money(product.price, symbol)}`
        : isKu
          ? `Biha: ${money(product.price, symbol)}`
          : isTr
            ? `Fiyat: ${money(product.price, symbol)}`
            : `السعر: ${money(product.price, symbol)}`
      : isEn
        ? "Price upon request"
        : isKu
          ? "Bihayê taybet"
          : isTr
            ? "Fiyat sorunuz"
            : "السعر يحدده الدعم";

  const kindText =
    product.kind === "hardware" || product.kind === "accessory"
      ? isEn
        ? "Physical delivery"
        : isKu
          ? "Şandina fizîkî"
          : isTr
            ? "Fiziksel teslimat"
            : "شحن وتوصيل للمنزل"
      : isEn
        ? "Instant digital delivery"
        : isKu
          ? "Radestkirina dîjîtal a zindî"
          : isTr
            ? "Anında dijital teslimat"
            : "تسليم رقمي فوري بالمحادثة";

  const name = lang !== "ar" && product.titleEn ? product.titleEn : product.title;

  return {
    kind: "product",
    id: product.id,
    name,
    text: `${priceText} · ${kindText}`,
    ...(product.image ? { image: product.image } : {}),
  };
}

function orderLines(order: SafeOrder, symbol: string, lang: SupportLang): string {
  const items = order.items.map((item) => `${item.title} ×${item.quantity}`).join(", ");
  const paymentMap = PAYMENT_I18N[lang] || PAYMENT_I18N.ar;
  const statusStr = orderStatusLabel(order.status, order.paymentStatus, lang);
  const paymentStr = paymentMap[order.paymentStatus] ?? order.paymentStatus;

  if (lang === "en") {
    const lines = [
      `Order ${order.code}: ${statusStr} · Payment: ${paymentStr}`,
      `Items: ${items}`,
      `Total: ${money(order.total, order.currency || symbol)}`,
    ];
    if (order.needsAddress) {
      lines.push(
        order.hasAddress
          ? `Delivery Address: ${order.addressSummary || "Registered"} - Shipping in progress.`
          : "Delivery address needed — please reply with your city, area, and phone number.",
      );
    } else {
      const delivered = order.items.filter((item) => item.credsSentAt);
      lines.push(
        delivered.length
          ? `Credentials for ${delivered.length} of ${order.items.length} items delivered in this chat.`
          : "Instant digital delivery will appear directly in this chat upon payment verification.",
      );
    }
    return lines.join("\n");
  }

  if (lang === "ku") {
    const lines = [
      `Siparîş ${order.code}: ${statusStr} · Dravdan: ${paymentStr}`,
      `Berhem: ${items}`,
      `Tevahî: ${money(order.total, order.currency || symbol)}`,
    ];
    if (order.needsAddress) {
      lines.push(
        order.hasAddress
          ? `Navnîşana radestkirinê: ${order.addressSummary || "Qeydkirî"} - Tê şandin.`
          : "Pêdivî bi navnîşanê heye — ji kerema xwe parêzgeh û jimara telefonê bişîne.",
      );
    } else {
      lines.push("Radestkirina dîjîtal piştî pejirandina dravdanê di vê axaftinê de tê şandin.");
    }
    return lines.join("\n");
  }

  if (lang === "tr") {
    const lines = [
      `Sipariş ${order.code}: ${statusStr} · Ödeme: ${paymentStr}`,
      `Ürünler: ${items}`,
      `Toplam: ${money(order.total, order.currency || symbol)}`,
    ];
    if (order.needsAddress) {
      lines.push(
        order.hasAddress
          ? `Teslimat Adresi: ${order.addressSummary || "Kayıtlı"} - Kargo hazırlanıyor.`
          : "Teslimat adresi gerekli — lütfen il, ilçe ve telefon bilginizi yazın.",
      );
    } else {
      lines.push("Dijital ürün bilgileri ödeme onayından sonra anında bu sohbette teslim edilir.");
    }
    return lines.join("\n");
  }

  // Arabic default
  const lines = [
    `طلبك ${order.code}: ${statusStr} · الدفع: ${paymentStr}`,
    `المنتجات: ${items}`,
    `الإجمالي: ${money(order.total, order.currency || symbol)}`,
  ];
  if (order.needsAddress) {
    lines.push(
      order.hasAddress
        ? `عنوان التوصيل مسجّل${order.addressSummary ? `: ${order.addressSummary}` : ""} ويجري تجهيز الشحن.`
        : "ينقصنا عنوان التوصيل — أرسله هنا (المحافظة، المنطقة، أقرب نقطة دالة، رقم الهاتف).",
    );
  } else {
    const delivered = order.items.filter((item) => item.credsSentAt);
    lines.push(
      delivered.length
        ? `تم تسليم بيانات ${delivered.length} من ${order.items.length} داخل هذه المحادثة.`
        : "التسليم رقمي داخل محادثة الطلب مباشرة بعد تأكيد الدفع.",
    );
  }
  return lines.join("\n");
}

/** Pick the best knowledge-base article */
function pickArticle(
  input: string,
  detection: Detection,
  articles: KbArticle[],
  memory: SupportMemory,
  forcedId?: string,
): { article?: KbArticle; strong: boolean } {
  if (forcedId) {
    const forced = articles.find((article) => article.id === forcedId);
    if (forced) return { article: forced, strong: true };
  }
  const forms = surfaces(input);
  const scored = articles
    .map((article) => {
      let score = 0;
      if (detection.errorCode && (article.errorCodes ?? []).includes(detection.errorCode))
        score += 10;
      if (matchAny(forms, article.match)) score += 4;
      if (matchAny(forms, [article.title])) score += 3;
      if (memory.offeredArticles.includes(article.id)) score -= 5;
      return { article, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return { strong: false };
  return { article: best.article, strong: best.score >= 7 };
}

export function supportAnswer(
  input: string,
  context: SupportContext,
  hint?: SupportHint,
): SupportReply {
  const ctx: SupportContext = {
    ...context,
    memory: context.memory ?? emptyMemory(),
    articles: context.articles?.length ? context.articles : BUILTIN_ARTICLES,
  };
  const symbol = ctx.currencySymbol || "د.ع";
  const lang: SupportLang = detectLang(input, ctx.lang ?? "ar");

  // Decline before interpreting: asked for another customer's data the intent
  // detector would otherwise answer about the asker's own account, which reads
  // as if the request had been honoured.
  const sensitive = detectSensitive(input);
  if (sensitive) {
    return {
      text: sensitiveReply(sensitive, lang),
      cards: [],
      suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
      // A refusal should not dead-end: staff can still take it from here.
      escalate: sensitive !== "other_customer",
      memory: ctx.memory,
      trace: {
        intent: "unknown",
        candidates: [],
        confidence: "high",
        reason: `sensitive_${sensitive}`,
      },
    };
  }

  const base = detect(input, ctx);

  const hintedProduct = hint?.productId
    ? ctx.products.find((product) => product.id === hint.productId)
    : undefined;
  const hintedOrder = hint?.orderCode
    ? ctx.orders.find((order) => order.code === hint.orderCode)
    : undefined;

  const matchedProductList: SafeProduct[] = hint?.matchedProductIds?.length
    ? ctx.products.filter((p) => hint.matchedProductIds!.includes(p.id))
    : hintedProduct
      ? [hintedProduct]
      : [];

  const detection: Detection = {
    ...base,
    ...(hint?.needsHuman ? { intent: "human_agent", confidence: "high" } : {}),
    ...(!hint?.needsHuman && hint?.intent && hint.intent !== "unknown"
      ? { intent: hint.intent, confidence: "high" }
      : {}),
    ...(matchedProductList.length ? { products: matchedProductList } : {}),
    ...(hintedOrder ? { order: hintedOrder, orderCode: hintedOrder.code } : {}),
    ...(hint?.errorCode ? { errorCode: hint.errorCode } : {}),
  };

  const memory: SupportMemory = {
    ...ctx.memory,
    ...(detection.order ? { focusOrderCode: detection.order.code } : {}),
    ...(detection.products[0] ? { focusProductId: detection.products[0].id } : {}),
  };

  const build = (
    text: string,
    options: {
      cards?: SupportCard[];
      suggestions?: string[];
      escalate?: boolean;
      articleId?: string;
      reason: string;
      asked?: string;
      memory?: Partial<SupportMemory>;
    },
  ): SupportReply => {
    const nextMemory: SupportMemory = {
      ...memory,
      ...(options.memory ?? {}),
      offeredArticles: options.articleId
        ? [...new Set([...memory.offeredArticles, options.articleId])]
        : memory.offeredArticles,
      askedQuestions: options.asked
        ? [...new Set([...memory.askedQuestions, options.asked])]
        : memory.askedQuestions,
    };
    return {
      text,
      cards: options.cards ?? [],
      suggestions: options.suggestions ?? SUGGESTIONS_I18N[lang]?.default ?? [],
      escalate: Boolean(options.escalate),
      memory: nextMemory,
      trace: {
        intent: detection.intent,
        candidates: detection.candidates,
        confidence: detection.confidence,
        reason: options.reason,
        ...(options.articleId ? { articleId: options.articleId } : {}),
        ...(detection.orderCode ? { orderCode: detection.orderCode } : {}),
        ...(detection.products[0] ? { productId: detection.products[0].id } : {}),
        ...(detection.errorCode ? { errorCode: detection.errorCode } : {}),
      },
    };
  };

  // 1. If Gemini AI already constructed a rich generative answer, use it directly!
  if (hint?.generatedResponse) {
    const cards: SupportCard[] = [];
    if (detection.products.length) {
      cards.push(...detection.products.slice(0, 3).map((p) => productCard(p, symbol, lang)));
    }
    if (detection.order && detection.intent === "order_status") {
      cards.push({
        kind: "order",
        code: detection.order.code,
        text: detection.order.items.map((i) => i.title).join(", "),
      });
    }

    const suggestions = hint.generatedSuggestions?.length
      ? hint.generatedSuggestions
      : (SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default);

    return build(hint.generatedResponse, {
      cards,
      suggestions,
      escalate: Boolean(hint.needsHuman),
      reason: "gemini_ai_generated_response",
    });
  }

  // 2. Deterministic Multilingual Fallback Engine
  const escalateNote =
    lang === "en"
      ? "I will transfer you to the live support team now — please tap 'Talk to Support' to continue with an agent in this chat."
      : lang === "ku"
        ? "Ez ê te derbasî tîma piştgiriyê bikim — ji kerema xwe bitikîne 'Bi piştgiriyê re biaxive' da ku bi rêvebirekî re berdewam bikî."
        : lang === "tr"
          ? "Sizi şimdi canlı destek ekibimize aktarıyorum — bu sohbette yetkiliyle görüşmek için lütfen 'Destekle Görüş' butonuna tıklayın."
          : "سأحوّلك إلى فريق الدعم والإدارة الآن — اضغط «تحدث مع الدعم» وسيصلك الرد في نفس المحادثة.";

  const escalate = (reason: string, note = escalateNote) =>
    build(note, {
      escalate: true,
      suggestions: [SUGGESTIONS_I18N[lang]?.support ?? "تحدث مع الدعم"],
      reason,
    });

  if (!norm(input)) {
    const emptyMsg =
      lang === "en"
        ? "How can I help you today? 👋"
        : lang === "ku"
          ? "Çawa dikarim alîkariya te bikim? 👋"
          : lang === "tr"
            ? "Bugün size nasıl yardımcı olabilirim? 👋"
            : "اكتب استفسارك وسأساعدك فوراً 👋";
    return build(emptyMsg, {
      suggestions: SUGGESTIONS_I18N[lang]?.greeting ?? SUGGESTIONS_I18N.ar.greeting,
      reason: "empty_input",
    });
  }

  switch (detection.intent) {
    case "human_agent":
      return escalate("user_requested_human");

    case "greeting": {
      const name = ctx.userName ? ctx.userName.split(" ")[0] : "";
      const text =
        lang === "en"
          ? `Hello ${name || "there"}! 👋 Welcome to Bananto Store. I can help you track orders, browse games & accessories, solve technical problems, or explain payment methods.`
          : lang === "ku"
            ? `Silav ${name || "heval"}! 👋 Bi xêr hatî Bananto Store. Ez dikarim alîkariya te bikim bo şopandina siparîşan, lîstik û aksesoran, çareserkirina pirsgirêkan, an rêyên dravdanê.`
            : lang === "tr"
              ? `Merhaba ${name || ""}! 👋 Bananto Store'a hoş geldiniz. Sipariş takibi, oyun ve aksesuar arama, teknik destek ve ödeme yöntemleri konusunda yardımcı olabilirim.`
              : `أهلاً ${name || "بك"}! 👋 أنا المساعد الآلي لمتجر بنانا ستور. أستطيع مساعدتك في متابعة طلباتك، تصفح الألعاب والإكسسوارات، حل المشاكل التقنية، وشرح طرق الدفع.`;
      return build(text, {
        suggestions: SUGGESTIONS_I18N[lang]?.greeting ?? SUGGESTIONS_I18N.ar.greeting,
        reason: "greeting",
      });
    }

    case "thanks": {
      const text =
        lang === "en"
          ? "You're very welcome! 🌟 Let me know if you need any other assistance."
          : lang === "ku"
            ? "Ser çavan! 🌟 Heke pêdiviya te bi tiştekî din hebe ez li vir im."
            : lang === "tr"
              ? "Rica ederim! 🌟 Başka bir konuda yardıma ihtiyacınız olursa buradayım."
              : "على الرحب والسعة دائماً! 🌟 إذا احتجت أي مساعدة أخرى أنا هنا في خدمتك.";
      return build(text, {
        suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
        reason: "thanks",
      });
    }

    case "tried_already": {
      const nextMemory = { failedAttempts: memory.failedAttempts + 1 };
      if (memory.failedAttempts + 1 >= 2) {
        return escalate("repeated_failure");
      }
      const { article } = pickArticle(input, detection, ctx.articles, memory);
      if (article) {
        return build(
          [`${article.title}:`, ...article.steps.map((step, i) => `${i + 1}. ${step}`)].join("\n"),
          {
            articleId: article.id,
            suggestions: [
              lang === "en" ? "Still not working" : "ما زالت المشكلة",
              SUGGESTIONS_I18N[lang]?.support ?? "تحدث مع الدعم",
            ],
            reason: "alternate_article",
            memory: nextMemory,
          },
        );
      }
      const text =
        lang === "en"
          ? "Please tell me the exact error message or code on your screen, or send a screenshot."
          : lang === "ku"
            ? "Ji kerema xwe koda xeletiyê an peyama li ser ekranê binivîse."
            : lang === "tr"
              ? "Lütfen ekrandaki hata kodunu veya mesajını belirtin, ya da ekran görüntüsü gönderin."
              : "أخبرني بالضبط ما يظهر لك على الشاشة (نص الرسالة أو رمز الخطأ) وسأعطيك الحل.";
      return build(text, {
        suggestions: [SUGGESTIONS_I18N[lang]?.support ?? "تحدث مع الدعم"],
        reason: "need_more_signal",
        memory: nextMemory,
      });
    }

    case "order_status":
    case "order_where":
    case "payment_receipt":
    case "delivery_address": {
      if (!ctx.orders.length && !ctx.activeOrder) {
        const noOrdersText =
          lang === "en"
            ? "I don't see any orders on your account yet. Once you place an order, you can track it here live!"
            : lang === "ku"
              ? "Hîn tu siparîş li ser hesabê te xuya nake. Piştî kirîna yekem dê rewşa wê li vir bê nîşandan."
              : lang === "tr"
                ? "Hesabınızda henüz bir sipariş görünmüyor. İlk siparişinizi verdiğinizde durumunu buradan anlık takip edebilirsiniz."
                : "لا توجد طلبات على حسابك حتى الآن. بعد إتمام أول طلب، ستتمكن من متابعته لحظة بلحظة هنا!";
        return build(noOrdersText, {
          suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
          reason: "no_orders",
        });
      }

      const order = detection.order || ctx.orders[0];
      if (!order) return escalate("order_not_resolved");

      return build(orderLines(order, symbol, lang), {
        cards: [
          { kind: "order", code: order.code, text: order.items.map((i) => i.title).join(", ") },
        ],
        suggestions:
          order.paymentStatus === "unpaid"
            ? lang === "en"
              ? ["Payment Methods", "Upload Receipt"]
              : ["طرق الدفع", "رفع الوصل"]
            : (SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default),
        reason: "order_status_from_order_data",
      });
    }

    case "payment_how": {
      const text =
        lang === "en"
          ? "Accepted Payment Methods:\n• ZainCash (زين كاش)\n• First Iraqi Bank (FIB)\n• AsiaPay (آسيا باي)\n• Visa & Mastercard\n• Binance Pay (USDT Crypto)\n• Banana Wallet Balance\n\nAfter placing an order, upload your receipt in the chat for instant confirmation and delivery."
          : lang === "ku"
            ? "Rêyên dravdanê yên berdest:\n• ZainCash\n• FIB (First Iraqi Bank)\n• AsiaPay\n• Karta Bankî (Visa / Master)\n• Binance Pay (USDT)\n• Cizdana Mûzê\n\nPiştî siparîşê, wêneya wergirtinê li vir bar bike bo pejirandina bilez."
            : lang === "tr"
              ? "Geçerli Ödeme Yöntemleri:\n• ZainCash\n• FIB (First Iraqi Bank)\n• AsiaPay\n• Kredi Kartı (Visa / MasterCard)\n• Binance Pay (USDT Kripto)\n• Banana Cüzdan Bakiyesi\n\nSiparişten sonra dekont görüntüsünü bu sohbete yükleyerek anında onaylatabilirsiniz."
              : "طرق الدفع المتوفرة:\n• زين كاش (ZainCash)\n• المصرف العراقي الأول (FIB)\n• آسيا باي (AsiaPay)\n• البطاقات المصرفية (فيزا / ماستركارد)\n• باينانس باي (Binance Pay / USDT)\n• رصيد محفظة الموز\n\nبعد إتمام الطلب، أرسل صورة الوصل في المحادثة لتأكيده وتجهيزه فوراً.";
      return build(text, {
        suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
        reason: "faq_payment",
      });
    }

    case "account_credentials": {
      const order = detection.order;
      const delivered = order?.items.filter((item) => item.credsSentAt) ?? [];
      if (delivered.length) {
        const text =
          lang === "en"
            ? `Your account login details have been delivered in this chat under the 'Account Credentials' message card. Tap 'Show' to reveal the password.`
            : `بيانات حسابك مرسلة في هذه المحادثة. اضغط على «إظهار» لعرض كلمة المرور.`;
        return build(text, {
          suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
          reason: "credentials_already_delivered",
        });
      }
      const text =
        lang === "en"
          ? "Account credentials will be sent directly in this chat as soon as payment is confirmed."
          : "الطلب قيد التجهيز، وتصلك بيانات الحساب في هذه المحادثة فور تأكيد الدفع.";
      return build(text, {
        suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
        reason: "credentials_in_preparation",
      });
    }

    case "verification_code": {
      const text =
        lang === "en"
          ? "Keep the verification code screen open on your Nintendo Switch. Please reply with your Order Code, and our team will fetch your code immediately!"
          : "لا تُغلق شاشة الرمز على جهازك. أرسل رقم الطلب وسنجلب رمز التحقق من بريد الحساب ونرسله لك فوراً.";
      return build(text, {
        suggestions: [SUGGESTIONS_I18N[lang]?.support ?? "تحدث مع الدعم"],
        escalate: true,
        reason: "verification_code_flow",
      });
    }

    case "account_login_problem":
    case "game_not_opening":
    case "primary_device": {
      const { article } = pickArticle(input, detection, ctx.articles, memory, hint?.articleId);
      if (article) {
        return build(
          [`${article.title}:`, ...article.steps.map((step, i) => `${i + 1}. ${step}`)].join("\n"),
          {
            articleId: article.id,
            suggestions: [
              lang === "en" ? "Still not working" : "جربت وما نفع",
              SUGGESTIONS_I18N[lang]?.support ?? "تحدث مع الدعم",
            ],
            reason: "article_match",
          },
        );
      }
      const text =
        lang === "en"
          ? "Please tell me the error code or message appearing on your screen, or send a screenshot."
          : "أخبرني ما يظهر بالضبط على الشاشة (نص الرسالة أو رمز الخطأ) وسأساعدك بخطوات حلها فوراً.";
      return build(text, {
        suggestions: [SUGGESTIONS_I18N[lang]?.support ?? "تحدث مع الدعم"],
        reason: "problem_needs_detail",
      });
    }

    case "refund_cancel": {
      const text =
        lang === "en"
          ? "Orders can be cancelled free of charge prior to digital credentials delivery or physical shipment dispatch. All accounts are backed by a full warranty guarantee."
          : "يمكن إلغاء الطلب مجاناً قبل تسليم بيانات الحساب أو قبل شحن المنتج. جميع الحسابات مغطاة بضمان كامل في حال وجود أي عطل.";
      return build(text, {
        suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
        reason: "policy_refund",
      });
    }

    case "warranty": {
      const text =
        lang === "en"
          ? "All digital accounts and games come with a 100% Lifetime Guarantee: if you ever encounter any access or technical issues, we fix or replace it immediately and free of charge!"
          : "جميع الحسابات والألعاب الرقمية مشمولة بضمان استمرارية كامل: إذا واجهت أي مشكلة تقنية أو فقدان وصول يتم حلها أو استبدال الحساب فوراً ومجاناً.";
      return build(text, {
        suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
        reason: "policy_warranty",
      });
    }

    case "banana_wallet": {
      // Answer with the member's own figures when they are available — a
      // generic explainer is useless to someone asking where their top-up went.
      const wallet = ctx.wallet;
      if (wallet) {
        const money = `${Math.round(wallet.balance).toLocaleString("en-US")} ${
          lang === "en" ? "IQD" : "د.ع"
        }`;
        const lines: string[] =
          lang === "en"
            ? [
                `Your wallet balance is ${money}, and you have ${wallet.bananaBalance.toLocaleString("en-US")} Bananas.`,
              ]
            : [
                `رصيد محفظتك الحالي ${money}، ولديك ${wallet.bananaBalance.toLocaleString("en-US")} موزة.`,
              ];

        if (wallet.pendingTopUps.length) {
          const total = wallet.pendingTopUps.reduce((sum, entry) => sum + entry.amount, 0);
          lines.push(
            lang === "en"
              ? `You have ${wallet.pendingTopUps.length} top-up request(s) worth ${Math.round(total).toLocaleString("en-US")} IQD still under review — they are credited as soon as the team confirms the transfer.`
              : `لديك ${wallet.pendingTopUps.length} طلب تعبئة بقيمة ${Math.round(total).toLocaleString("en-US")} د.ع قيد المراجعة، وتُضاف فور تأكيد الفريق للتحويل.`,
          );
        }

        /*
          Under maintenance the bot must not advertise what the shop has
          paused: it says the balance is kept and the feature is coming back.
        */
        const bananasPaused = isUnderMaintenance("bananas") || isUnderMaintenance("bananaMarket");
        lines.push(
          bananasPaused
            ? lang === "en"
              ? "Bananas and the Banana Market are under maintenance for now; your balance is kept in full and will be usable again soon."
              : "الموز وسوق الموز تحت الصيانة حالياً؛ رصيدك محفوظ بالكامل وسيعود استخدامه قريباً."
            : lang === "en"
              ? "Bananas are earned on every order and can be redeemed for discounts or traded in the Banana Market."
              : "تُجمع الموز من كل طلب، ويمكن استبدالها بخصومات أو تداولها في سوق الموز.",
        );

        return build(lines.join(" "), {
          suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
          reason: wallet.pendingTopUps.length ? "wallet_balance_pending" : "wallet_balance",
        });
      }

      const text =
        isUnderMaintenance("bananas") || isUnderMaintenance("bananaMarket")
          ? lang === "en"
            ? "Banana Wallet is our reward points system. Bananas and the Banana Market are under maintenance for now; every balance is kept in full."
            : "محفظة الموز هي نظام المكافآت في المتجر. الموز وسوق الموز تحت الصيانة حالياً، وكل الأرصدة محفوظة بالكامل."
          : lang === "en"
            ? "Banana Wallet is our reward points system: earn Bananas on every order, redeem them for discounts and perks, or trade them in the live peer-to-peer Banana Market!"
            : "محفظة الموز (Banana Wallet) هي نظام المكافآت الحصري: تجمع الموز من مشترياتك وتستبدله بخصومات ومكافآت، أو تتداول به في «سوق الموز» الحي وفق أسعار العرض والطلب.";
      return build(text, {
        suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
        reason: "faq_banana",
      });
    }

    case "price_question":
    case "product_search": {
      const found = detection.products.length
        ? detection.products
        : findProducts(input, ctx.products, 3);

      if (found.length) {
        const text =
          lang === "en"
            ? "Here are the matching products in our store:"
            : lang === "ku"
              ? "Berhemên dîtî yên li dikanê:"
              : lang === "tr"
                ? "Mağazamızdaki eşleşen ürünler:"
                : "إليك أبرز المنتجات المتوفرة في المتجر:";

        return build(text, {
          cards: found.map((p) => productCard(p, symbol, lang)),
          suggestions: found
            .slice(0, 3)
            .map((p) => (lang !== "ar" && p.titleEn ? p.titleEn : p.title)),
          reason: "catalogue_match",
        });
      }

      const noMatchText =
        lang === "en"
          ? "Please tell me the name of the game or accessory you're looking for, and I'll find its availability and price for you!"
          : lang === "ku"
            ? "Navê lîstik an aksesorê binivîse da ku biha û rewşa wê bibînim!"
            : lang === "tr"
              ? "Aradığınız oyun veya aksesuarın adını yazın, fiyat ve stok bilgisini getireyim!"
              : "أخبرني باسم اللعبة أو الإكسسوار وسأعطيك سعره وتفاصيله فوراً!";

      return build(noMatchText, {
        suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
        reason: "catalogue_no_match",
      });
    }

    default:
      break;
  }

  // Fallback for general queries
  const defaultText =
    lang === "en"
      ? "Welcome to Bananto Store! 🎮 I'm your AI gaming assistant. I can help you with: browsing games & accessories, checking prices, tracking orders, explaining payment methods, or transferring you to an admin."
      : lang === "ku"
        ? "Bi xêr hatî Bananto Store! 🎮 Ez alîkarê te yê zîrek im. Ez dikarim alîkariyê bidim bo: dîtina lîstikan, biha, şopandina siparîşan, rêyên dravdanê, an peywendî bi rêvebir re."
        : lang === "tr"
          ? "Bananto Store'a hoş geldiniz! 🎮 Akıllı asistanınız olarak size oyun/aksesuar arama, fiyat bilgisi, sipariş takibi ve ödeme yöntemleri konularında yardımcı olabilirim."
          : "أهلاً بك في متجر بنانا ستور! 🎮 أستطيع مساعدتك في: تصفح الألعاب والإكسسوارات، معرفة الأسعار، متابعة الطلبات، شرح طرق الدفع، أو تحويلك للإدارة مباشرة.";

  return build(defaultText, {
    suggestions: SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default,
    reason: "unknown_intent",
  });
}

/** Suggestion chips shown before the user types anything. */
export function openingSuggestions(ctx: SupportContext): string[] {
  const lang = ctx.lang ?? "ar";
  return SUGGESTIONS_I18N[lang]?.default ?? SUGGESTIONS_I18N.ar.default;
}

export const INTENT_IDS = Object.keys(INTENT_PHRASES);
