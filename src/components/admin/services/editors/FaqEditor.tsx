import React, { useState } from "react";
import { Plus, Trash2, GripVertical, Settings2, Sparkles, HelpCircle } from "lucide-react";
import { useI18n } from "@/i18n";
import type { FaqCategory, FaqItem } from "@/lib/content";
import ServiceImportModal from "../ServiceImportModal";
import type { FaqParseResultData, ServiceParseResult } from "@/lib/servicesImport";

interface FaqEditorProps {
  categories: FaqCategory[];
  faq: FaqItem[];
  onChangeCategories: (cats: FaqCategory[]) => void;
  onChangeFaq: (faqs: FaqItem[]) => void;
}

export function FaqEditor({ categories, faq, onChangeCategories, onChangeFaq }: FaqEditorProps) {
  const t = useI18n((s) => s.t);
  const [activeTab, setActiveTab] = useState<"questions" | "categories">("questions");
  const [showImportModal, setShowImportModal] = useState(false);

  // --- Categories Management ---
  const addCategory = () => {
    onChangeCategories([
      ...categories,
      { id: "cat-" + Date.now(), name_ar: "", sort_order: categories.length + 1, published: true },
    ]);
  };
  const updateCategory = (id: string, name: string) => {
    onChangeCategories(categories.map((c) => (c.id === id ? { ...c, name_ar: name } : c)));
  };
  const removeCategory = (id: string) => {
    onChangeCategories(categories.filter((c) => c.id !== id));
  };

  // --- FAQs Management ---
  const addFaq = () => {
    onChangeFaq([
      ...faq,
      {
        id: "faq-" + Date.now(),
        category_id: categories[0]?.id || "",
        question_ar: "",
        answer_ar: "",
        keywords: "",
        sort_order: faq.length + 1,
        featured: false,
        published: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  };
  const updateFaq = (id: string, field: keyof FaqItem, value: any) => {
    onChangeFaq(faq.map((f) => (f.id === id ? { ...f, [field]: value } : f)));
  };
  const removeFaq = (id: string) => {
    onChangeFaq(faq.filter((f) => f.id !== id));
  };

  const handleImportResult = (result: ServiceParseResult<FaqParseResultData>) => {
    if (result.data) {
      if (result.data.categories && result.data.categories.length > 0) {
        // Merge categories without duplicating IDs
        const existingCatIds = new Set(categories.map((c) => c.id));
        const newCats = result.data.categories.filter((c) => !existingCatIds.has(c.id));
        onChangeCategories([...categories, ...newCats]);
      }
      if (result.data.faqs && result.data.faqs.length > 0) {
        const mappedFaqs: FaqItem[] = result.data.faqs.map((f) => ({
          ...f,
          keywords: f.keywords || "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        onChangeFaq([...faq, ...mappedFaqs]);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-4 rounded-2xl">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-base text-foreground">
            {t("إدارة الأسئلة الشائعة والأقسام")}
          </h3>
        </div>

        <button
          onClick={() => setShowImportModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-primary/10 text-primary hover:bg-primary/20 rounded-xl transition-colors border border-primary/20"
        >
          <Sparkles className="w-4 h-4" />
          {t("استيراد من قالب الأسئلة")}
        </button>
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("questions")}
          className={`px-4 py-2 font-bold text-sm rounded-lg transition-colors ${activeTab === "questions" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
        >
          {t("الأسئلة والإجابات")} ({faq?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("categories")}
          className={`px-4 py-2 font-bold text-sm rounded-lg transition-colors ${activeTab === "categories" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
        >
          {t("أقسام الأسئلة")} ({categories?.length || 0})
        </button>
      </div>

      {activeTab === "categories" && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {t("تصنيفات الأسئلة لتسهيل تصفحها على العملاء.")}
            </p>
            <button
              onClick={addCategory}
              className="flex items-center gap-2 text-sm bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-bold hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("إضافة قسم")}
            </button>
          </div>
          <div className="grid gap-3">
            {categories.map((c, i) => (
              <div
                key={c.id}
                className="flex items-center gap-3 bg-card border border-border p-3 rounded-xl"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={c.name_ar}
                  onChange={(e) => updateCategory(c.id, e.target.value)}
                  placeholder={t("اسم القسم...")}
                  className="flex-1 border border-border rounded-lg px-3 py-1.5 bg-background focus:border-primary outline-none text-sm"
                />
                <button
                  onClick={() => removeCategory(c.id)}
                  className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "questions" && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {t("أضف الأسئلة الشائعة التي يطرحها عملائك.")}
            </p>
            <button
              onClick={addFaq}
              className="flex items-center gap-2 text-sm bg-primary/10 text-primary px-4 py-2 rounded-lg font-bold hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("سؤال جديد")}
            </button>
          </div>
          <div className="grid gap-4">
            {faq.map((f, i) => (
              <div
                key={f.id}
                className="bg-card border border-border p-4 rounded-xl flex gap-4 items-start"
              >
                <div className="mt-2 text-muted-foreground cursor-move">
                  <GripVertical className="w-5 h-5" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-bold mb-1">{t("السؤال")}</label>
                      <input
                        type="text"
                        value={f.question_ar}
                        onChange={(e) => updateFaq(f.id, "question_ar", e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none text-sm font-bold"
                      />
                    </div>
                    <div className="w-48">
                      <label className="block text-xs font-bold mb-1">{t("القسم")}</label>
                      <select
                        value={f.category_id}
                        onChange={(e) => updateFaq(f.id, "category_id", e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none text-sm"
                      >
                        <option value="">{t("بدون قسم")}</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">{t("الإجابة")}</label>
                    <textarea
                      value={f.answer_ar}
                      onChange={(e) => updateFaq(f.id, "answer_ar", e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none text-sm min-h-[80px]"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t(
                        "اكتب جواباً قصيراً. الشرح الكامل يعيش في الدليل أو السياسة، ورابطه في الحقل التالي.",
                      )}
                    </p>
                  </div>
                  <div>
                    {/*
                      Where the long answer lives.

                      Writing it here as well means two copies of every rule,
                      and the copy nobody remembers to update is the one a
                      customer reads. Same-origin only — an FAQ answer is not a
                      place from which to send somebody off the site.
                    */}
                    <label className="block text-xs font-bold mb-1">
                      {t("رابط الشرح الكامل (داخل الموقع)")}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={(f as { more_href?: string }).more_href || ""}
                      onChange={(e) => updateFaq(f.id, "more_href" as never, e.target.value)}
                      placeholder="/account_guides#login-method-1"
                      className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none text-sm font-mono"
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeFaq(f.id)}
                  className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors mt-6"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {showImportModal && (
        <ServiceImportModal
          type="faq"
          onClose={() => setShowImportModal(false)}
          onImport={handleImportResult}
        />
      )}
    </div>
  );
}
