import React, { useState } from "react";
import { Plus, Trash2, GripVertical, Sparkles, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n";
import { ImageSlotsEditor } from "../../ImageSlotsEditor";
import type { PolicyData, PolicySection } from "@/lib/content";
import ServiceImportModal from "../ServiceImportModal";
import type { PolicyParseResultData, ServiceParseResult } from "@/lib/servicesImport";

interface PolicyEditorProps {
  policy: PolicyData;
  onChange: (policy: PolicyData) => void;
  label: string;
}

export function PolicyEditor({ policy, onChange, label }: PolicyEditorProps) {
  const t = useI18n((s) => s.t);
  const [showImportModal, setShowImportModal] = useState(false);

  const updateField = (field: keyof PolicyData, value: any) => {
    onChange({ ...policy, [field]: value });
  };

  const addSection = () => {
    const newSection: PolicySection = {
      id: "sec-" + Date.now(),
      title_ar: "",
      body_ar: "",
      sort_order: (policy.sections?.length || 0) + 1,
      highlight: false,
    };
    onChange({ ...policy, sections: [...(policy.sections || []), newSection] });
  };

  const updateSection = (id: string, field: keyof PolicySection, value: any) => {
    const newSections = policy.sections.map((s) => (s.id === id ? { ...s, [field]: value } : s));
    onChange({ ...policy, sections: newSections });
  };

  const removeSection = (id: string) => {
    onChange({ ...policy, sections: policy.sections.filter((s) => s.id !== id) });
  };

  const handleImportResult = (result: ServiceParseResult<PolicyParseResultData>) => {
    if (result.data) {
      onChange({
        ...policy,
        title_ar: result.data.title_ar || policy.title_ar,
        title_en: result.data.title_en || policy.title_en,
        subtitle_ar: result.data.subtitle_ar || policy.subtitle_ar,
        subtitle_en: result.data.subtitle_en || policy.subtitle_en,
        version: result.data.version || policy.version,
        effective_date: result.data.effective_date || policy.effective_date,
        important_notices: result.data.important_notices || policy.important_notices,
        contact_note: result.data.contact_note || policy.contact_note,
        // البنود الجديدة تُضاف فوق الموجودة بدل استبدالها
        sections: [
          ...(policy.sections || []),
          ...((result.data.sections || []) as PolicySection[]).filter(
            (s) => !(policy.sections || []).some((existing) => existing.id === s.id),
          ),
        ].map((s, idx) => ({ ...s, sort_order: idx + 1 })),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-4 rounded-2xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-base text-foreground">{label}</h3>
        </div>

        <button
          onClick={() => setShowImportModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-primary/10 text-primary hover:bg-primary/20 rounded-xl transition-colors border border-primary/20"
        >
          <Sparkles className="w-4 h-4" />
          {t("استيراد من قالب السياسة")}
        </button>
      </div>

      <div className="bg-card border border-border p-6 rounded-xl space-y-4">
        <h2 className="text-lg font-bold">
          {label} - {t("البيانات الأساسية")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-1">{t("العنوان")}</label>
            <input
              type="text"
              value={policy.title_ar || ""}
              onChange={(e) => updateField("title_ar", e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">{t("الوصف الفرعي")}</label>
            <input
              type="text"
              value={policy.subtitle_ar || ""}
              onChange={(e) => updateField("subtitle_ar", e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-bold mb-1">
              {t("ملاحظة هامة (تظهر في البداية)")}
            </label>
            <textarea
              value={policy.important_notices || ""}
              onChange={(e) => updateField("important_notices", e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none min-h-[60px]"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("الأقسام والبنود")}</h2>
          <button
            onClick={addSection}
            className="flex items-center gap-2 text-sm bg-primary/10 text-primary px-4 py-2 rounded-lg font-bold hover:bg-primary/20 transition-colors"
          >
            <Plus className="w-4 h-4" /> {t("إضافة قسم جديد")}
          </button>
        </div>

        {policy.sections?.map((sec, index) => (
          <div
            key={sec.id}
            className="bg-card border border-border p-4 rounded-xl flex gap-4 items-start"
          >
            <div className="mt-2 text-muted-foreground cursor-move">
              <GripVertical className="w-5 h-5" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold mb-1">
                    {t("عنوان القسم")} ({index + 1})
                  </label>
                  <input
                    type="text"
                    value={sec.title_ar || ""}
                    onChange={(e) => updateSection(sec.id, "title_ar", e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none text-sm font-bold"
                  />
                </div>
                <div className="pt-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sec.highlight || false}
                      onChange={(e) => updateSection(sec.id, "highlight", e.target.checked)}
                      className="w-4 h-4 rounded text-primary focus:ring-primary border-border"
                    />
                    <span>{t("تمييز (مهم)")}</span>
                  </label>
                </div>
              </div>
              <div>
                {/*
                  One sentence, shown in the summary at the top of the page.

                  The clauses that decide whether somebody keeps their game sat
                  nine screens down a wall of prose. A customer who reads only
                  the summary must still learn not to delete the account.
                */}
                <label className="block text-xs font-bold mb-1">
                  {t("ملخص القسم — سطر واحد يظهر أعلى الصفحة")}
                </label>
                <input
                  type="text"
                  value={sec.summary_ar || ""}
                  onChange={(e) => updateSection(sec.id, "summary_ar", e.target.value)}
                  placeholder={t("جملة واحدة تلخّص البند")}
                  className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none text-sm"
                />
              </div>
              <div>
                {/*
                  The fragment an order card, a support reply or the FAQ links
                  to. Changing it breaks every link already written, so it is
                  edited deliberately rather than derived from the title.
                */}
                <label className="block text-xs font-bold mb-1">
                  {t("مُعرّف الرابط (Anchor) — تغييره يكسر الروابط القديمة")}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={sec.anchor || ""}
                  onChange={(e) =>
                    updateSection(
                      sec.id,
                      "anchor",
                      e.target.value.replace(/[^a-z0-9-]/gi, "").toLowerCase(),
                    )
                  }
                  placeholder="warranty"
                  className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t("نص القسم")}</label>
                <textarea
                  value={sec.body_ar || ""}
                  onChange={(e) => updateSection(sec.id, "body_ar", e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 bg-background focus:border-primary outline-none min-h-[100px] text-sm"
                />
              </div>
              <div>
                <ImageSlotsEditor
                  images={sec.images}
                  onChange={(images) => updateSection(sec.id, "images", images)}
                  folder="pages"
                  label={t("صور البند (اختياري)")}
                />
              </div>
            </div>
            <button
              onClick={() => removeSection(sec.id)}
              className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors mt-6"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ))}
        {(!policy.sections || policy.sections.length === 0) && (
          <div className="text-center py-8 text-muted-foreground bg-card border border-border rounded-xl">
            {t("لا توجد أقسام حالياً. أضف قسماً للبدء.")}
          </div>
        )}
      </div>

      {showImportModal && (
        <ServiceImportModal
          type="purchase_policy"
          onClose={() => setShowImportModal(false)}
          onImport={handleImportResult}
        />
      )}
    </div>
  );
}
