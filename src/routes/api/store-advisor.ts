import { createFileRoute } from "@tanstack/react-router";
import { GoogleGenAI } from "@google/genai";
import { getStore, listOrders } from "@/lib/db.server";
import type { Order } from "@/lib/types";
import { d1All, ensureSchema, getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";

interface AdvisorAction {
  label: string;
  tab: string;
  badge?: string;
}

interface AdvisorResult {
  reply: string;
  summary?: string;
  actionableTips: string[];
  suggestedActions: AdvisorAction[];
  sentiment: "positive" | "attention" | "opportunity" | "critical";
  healthScore: number;
  statsSnapshot?: {
    pendingOrders: number;
    lowStockCount: number;
    avgRating: number;
    totalProducts: number;
    totalOrders: number;
  };
}

async function gatherLiveStoreData() {
  const store = await getStore();
  /*
    Typed on the failure branch as well as the success one.

    `catch(() => [])` gives back `Order[] | never[]`, and every `orders.filter`
    below then reads its callback parameter as `never` — so the counts on the
    advisor's dashboard depended on nothing worse than which order TypeScript
    happened to resolve the modules in. Naming the type on both branches is
    what makes them one array.
  */
  const orders: Order[] = await listOrders().catch(() => []);

  let reviews: any[] = [];
  if (getD1()) {
    try {
      await ensureSchema();
      reviews = await d1All(
        `SELECT rating, comment, status, created_at FROM product_reviews ORDER BY created_at DESC LIMIT 50`,
      );
    } catch {
      reviews = [];
    }
  }

  const products = store.products || [];
  const categories = store.categories || [];
  const banners = store.banners || [];

  const pendingOrders = orders.filter((o) => o.status === "pending" || !o.status).length;
  const processingOrders = orders.filter((o) => o.status === "processing").length;
  const shippedOrders = orders.filter((o) => o.status === "delivering").length;
  const completedOrders = orders.filter((o) => o.status === "completed").length;

  const lowStockProducts = products.filter(
    (p) => typeof p.stock === "number" && p.stock <= 2 && p.stock >= 0,
  );
  const outOfStockProducts = products.filter((p) => p.stock === 0);

  const avgRating =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / reviews.length) * 10,
        ) / 10
      : 5.0;

  return {
    storeName: store.settings?.storeName || "بنانتو",
    totalProducts: products.length,
    lowStockCount: lowStockProducts.length,
    outOfStockCount: outOfStockProducts.length,
    lowStockSample: lowStockProducts.slice(0, 5).map((p) => `${p.title} (متبقي ${p.stock})`),
    totalOrders: orders.length,
    pendingOrders,
    processingOrders,
    shippedOrders,
    completedOrders,
    reviewsCount: reviews.length,
    avgRating,
    recentReviewsSample: reviews
      .slice(0, 4)
      .map((r) => `${r.rating}★: "${r.comment || "بدون تعليق"}"`),
    categoriesCount: categories.length,
    activeBannersCount: banners.length,
    recentOrdersSample: orders.slice(0, 4).map((o) => ({
      code: o.code,
      total: o.total,
      status: o.status,
      itemsCount: o.items?.length || 0,
    })),
  };
}

function generateRuleBasedAdvisor(
  prompt: string,
  mode: string,
  data: Awaited<ReturnType<typeof gatherLiveStoreData>>,
): AdvisorResult {
  const tips: string[] = [];
  const actions: AdvisorAction[] = [];
  let reply = "";
  let sentiment: AdvisorResult["sentiment"] = "positive";

  if (data.pendingOrders > 0) {
    tips.push(`تجهيز وشحن ${data.pendingOrders} طلبات معلقة لتسريع دورة التوصيل`);
    actions.push({
      label: "مراجعة الطلبات المعلقة",
      tab: "orders",
      badge: `${data.pendingOrders}`,
    });
    sentiment = "attention";
  }

  if (data.lowStockCount > 0) {
    tips.push(`إعادة تموين ${data.lowStockCount} منتج شارف على النفاد لتجنب خسارة المبيعات`);
    actions.push({
      label: "تحديث المخزون والأسعار",
      tab: "listings",
      badge: `${data.lowStockCount}`,
    });
    sentiment = "attention";
  }

  if (data.activeBannersCount === 0) {
    tips.push("إضافة بنر ترويجي رئيسي على الصفحة الرئيسية لجذب الزوار للعروض الحصرية");
    actions.push({ label: "إضافة بنر إعلاني", tab: "banners" });
  }

  if (data.reviewsCount === 0) {
    tips.push("تشجيع العملاء بعد استلام طلباتهم على كتابة مراجعات لزيادة الثقة ومعدل التحويل");
    actions.push({ label: "إدارة تقييمات الأعضاء", tab: "reviews" });
  }

  if (mode === "inventory" || prompt.includes("مخزون") || prompt.includes("تسعير")) {
    reply = `📦 **تحليل المخزون والتسعير الذكي لمتجر ${data.storeName}:**

- **إجمالي المنتجات:** ${data.totalProducts} منتجاً مسجلاً في الكتالوج.
- **تنبيه النواقص:** يوجد ${data.lowStockCount} منتجات بحاجة لإعادة تعبئة المخزون فوراً:
${data.lowStockSample.length > 0 ? data.lowStockSample.map((s) => `  • ${s}`).join("\n") : "  • جميع المنتجات الأساسية متوفرة حالياً."}

💡 **استراتيجية التسعير المقترحة:**
1. توفير حزم (Bundles) تضم الأجهزة الأكثر طلباً مع ملحق إضافي أو لعبة بخصم ترويجي 5-10%.
2. ضبط هامش الربح للمنتجات سريعة الدوران (الألعاب الأكثر شهرة) وتطبيق حوافز نقاط الموز لتعزيز ولاء الزبائن.`;
  } else if (
    mode === "marketing" ||
    prompt.includes("إعلان") ||
    prompt.includes("تسويق") ||
    prompt.includes("ترويج")
  ) {
    reply = `📣 **خطة التسويق والمحتوى المقترحة لمتجر ${data.storeName}:**

1. **إعلان العروض الأسبوعية (Social Media Copy):**
   > *"🎮 لا يفوتك أقوى عروض الألعاب والملحقات الأصلية في العراق مع متجر ${data.storeName}! توصيل سريع لكافة المحافظات + مكافآت حصرية مع كل طلب 🍌✨"*

2. **حملات البنرات والصفحة الرئيسية:**
   - نشر بنر تفاعلي لألعاب الشهر وحزم التبديل (Trade-in).
   - تفعيل إشعارات ترويجية للعملاء المهتمين بالألعاب الجديدة.`;
  } else if (
    mode === "growth" ||
    prompt.includes("زيادة") ||
    prompt.includes("نمو") ||
    prompt.includes("مبيعات")
  ) {
    reply = `🚀 **خطة تسريع نمو المبيعات لمتجر ${data.storeName}:**

- **معدل الطلبات الحالي:** ${data.totalOrders} طلباً إجمالياً.
- **تقييم المتجر:** ${data.avgRating} من 5 نجوم (${data.reviewsCount} تقييماً).

🎯 **أهم 3 أولويات تشغيلية اليوم:**
1. **سرعة الاستجابة:** سرعة تأكيد الطلبات المعلقة (${data.pendingOrders} طلب) تقلل نسبة الإلغاء وترفع ثقة العميل.
2. **سوق الموز والولاء:** تحفيز المشترين بزيادة مكافآت الموز المكتسبة مع كل عملية شراء.
3. **تنشيط التبادل (Disc Trade):** استقطاب اللاعبين عبر خدمة استبدال الأقراص المستعملة بمنتجات جديدة.`;
  } else {
    reply = `✨ **تقرير المستشار الذكي لمتجر ${data.storeName}:**

أهلاً بك يا مدير! قمت بتحليل بيانات المتجر الحالية:
- **الطلبات:** ${data.totalOrders} طلباً (${data.pendingOrders} بانتظار التجهيز، ${data.processingOrders} قيد المعالجة).
- **المخزون:** ${data.totalProducts} منتجاً، منها ${data.lowStockCount} منتجات منخفضة المخزون.
- **رضا العملاء:** متوسط تقييم ${data.avgRating}★ من ${data.reviewsCount} مراجعة.

يمكنك سؤالي عن أي جانب محدد: خطط التسويق، تسعير المنتجات، تنظيم الحملات، أو كتابة نصوص إعلانية موجهة للاعبين في العراق.`;
  }

  if (actions.length === 0) {
    actions.push({ label: "إدارة المنتجات", tab: "listings" });
    actions.push({ label: "متابعة الطلبات", tab: "orders" });
    actions.push({ label: "اقتصاد الموز", tab: "banana" });
  }

  const healthScore = Math.max(
    50,
    Math.min(
      98,
      100 -
        data.pendingOrders * 4 -
        data.lowStockCount * 3 +
        (data.avgRating >= 4.5 ? 10 : 0) +
        (data.activeBannersCount > 0 ? 5 : -5),
    ),
  );

  return {
    reply,
    summary: `تحليل مباشر لمتجر ${data.storeName} مع مؤشر أداء ${healthScore}%`,
    actionableTips:
      tips.length > 0
        ? tips
        : [
            "متابعة شحن الطلبات المعلقة فوراً",
            "إضافة عروض جديدة في بنرات الصفحة الرئيسية",
            "تشجيع الزبائن على تقييم المنتجات المستلمة",
          ],
    suggestedActions: actions,
    sentiment,
    healthScore,
    statsSnapshot: {
      pendingOrders: data.pendingOrders,
      lowStockCount: data.lowStockCount,
      avgRating: data.avgRating,
      totalProducts: data.totalProducts,
      totalOrders: data.totalOrders,
    },
  };
}

export const Route = createFileRoute("/api/store-advisor")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const liveData = await gatherLiveStoreData();
          const audit = generateRuleBasedAdvisor("تحليل شامل لأداء المتجر", "general", liveData);
          return json({
            success: true,
            liveData,
            audit,
          });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const payload = await body<{
            prompt?: string;
            mode?: string;
            history?: { role: "user" | "assistant"; text: string }[];
          }>(request);

          const prompt = payload.prompt?.trim() || "تحليل شامل وتوصيات فورية للمتجر";
          const mode = payload.mode || "general";
          const liveData = await gatherLiveStoreData();

          const apiKey = process.env.GEMINI_API_KEY;

          if (!apiKey) {
            const fallback = generateRuleBasedAdvisor(prompt, mode, liveData);
            return json(fallback);
          }

          try {
            const ai = new GoogleGenAI({ apiKey });

            const systemInstruction = `أنت "مستشار بنانتو الذكي" (Bananto AI Store Advisor) — خبير استراتيجي في التجارة الإلكترونية، التسويق الرقمي، إدارة المخزون، وسوق الألعاب الإلكترونية والأجهزة وملحقاتها في العراق والشرق الأوسط (Nintendo, PlayStation, Xbox, Games, Accessories, Digital codes, Banana loyalty currency).

البيانات الحية المباشرة لمتجر بنانتو الآن:
- اسم المتجر: ${liveData.storeName}
- إجمالي المنتجات: ${liveData.totalProducts}
- منتجات شارف مخزونها على النفاد (<= 2): ${liveData.lowStockCount} (${liveData.lowStockSample.join(", ") || "لا يوجد"})
- منتجات نفد مخزونها تماماً (0): ${liveData.outOfStockCount}
- إجمالي الطلبات: ${liveData.totalOrders}
- طلبات جديدة معلقة: ${liveData.pendingOrders}
- طلبات قيد المعالجة: ${liveData.processingOrders}
- طلبات تم تسليمها/مكتملة: ${liveData.completedOrders}
- متوسط تقييمات الأعضاء: ${liveData.avgRating} من 5 نجوم (عدد المراجعات: ${liveData.reviewsCount})
- عينات من التقييمات: ${liveData.recentReviewsSample.join(" | ") || "لا توجد بعد"}
- البنرات الترويجية الفعالة: ${liveData.activeBannersCount}
- الأقسام والتصنيفات: ${liveData.categoriesCount}

تعليمات الرد:
1. قدم تحليلاً استراتيجياً، مهنياً، ودقيقاً باللغة العربية بأسلوب راقٍ ومباشر بدون حشو أو تسويق فارغ.
2. نسق الإجابة باستخدام Markdown أنيق مع عناوين واضحة ونقاط تكتيكية قابلة للتنفيذ الفوري.
3. استند للبيانات والأرقام الحقيقية المذكورة أعلاه.
4. يجب أن يكون الرد بتنسيق JSON متوافق مع المخطط التالي تماماً:
{
  "reply": "نص الرد الكامل مع التنسيق الغني بالعناوين والنقاط بالماركداون",
  "summary": "ملخص تنفيذي في سطر أو سطرين",
  "actionableTips": ["خطوة عملية 1", "خطوة عملية 2", "خطوة عملية 3"],
  "suggestedActions": [
    { "label": "عنوان الزر", "tab": "orders" | "listings" | "banners" | "reviews" | "banana" | "messages" }
  ],
  "sentiment": "positive" | "attention" | "opportunity" | "critical",
  "healthScore": 85
}`;

            const response = await ai.models.generateContent({
              model: "gemini-3.7-flash",
              contents: [
                ...(payload.history || []).map((h) => ({
                  role: h.role === "assistant" ? "model" : "user",
                  parts: [{ text: h.text }],
                })),
                {
                  role: "user",
                  parts: [
                    {
                      text: `وضع الاستشارة: ${mode}\nسؤال/طلب المدير: ${prompt}`,
                    },
                  ],
                },
              ],
              config: {
                systemInstruction,
                responseMimeType: "application/json",
                temperature: 0.3,
              },
            });

            const rawText = response.text || "";
            let parsedJson: any = null;
            try {
              parsedJson = JSON.parse(rawText);
            } catch {
              // Extract JSON block if wrapped
              const match = rawText.match(/\{[\s\S]*\}/);
              if (match) {
                parsedJson = JSON.parse(match[0]);
              }
            }

            if (parsedJson && parsedJson.reply) {
              return json({
                reply: parsedJson.reply,
                summary: parsedJson.summary || "",
                actionableTips: Array.isArray(parsedJson.actionableTips)
                  ? parsedJson.actionableTips
                  : [],
                suggestedActions: Array.isArray(parsedJson.suggestedActions)
                  ? parsedJson.suggestedActions
                  : [
                      { label: "مراجعة الطلبات", tab: "orders" },
                      { label: "تحديث المخزون", tab: "listings" },
                    ],
                sentiment: parsedJson.sentiment || "positive",
                healthScore:
                  typeof parsedJson.healthScore === "number" ? parsedJson.healthScore : 88,
                statsSnapshot: {
                  pendingOrders: liveData.pendingOrders,
                  lowStockCount: liveData.lowStockCount,
                  avgRating: liveData.avgRating,
                  totalProducts: liveData.totalProducts,
                  totalOrders: liveData.totalOrders,
                },
              });
            }

            // If parsing failed but text exists
            return json({
              reply: rawText || "تم تحليل بيانات المتجر بنجاح.",
              summary: "تحليل ذكي لأداء المتجر",
              actionableTips: ["متابعة الطلبات المعلقة", "تحسين المخزون للسلع الناقصة"],
              suggestedActions: [
                { label: "إدارة الطلبات", tab: "orders" },
                { label: "إدارة المنتجات", tab: "listings" },
              ],
              sentiment: "positive",
              healthScore: 85,
              statsSnapshot: {
                pendingOrders: liveData.pendingOrders,
                lowStockCount: liveData.lowStockCount,
                avgRating: liveData.avgRating,
                totalProducts: liveData.totalProducts,
                totalOrders: liveData.totalOrders,
              },
            });
          } catch {
            const fallback = generateRuleBasedAdvisor(prompt, mode, liveData);
            return json(fallback);
          }
        }),
    },
  },
});
