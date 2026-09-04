import React, { useState } from "react";
import {
  Plus,
  Trash2,
  GripVertical,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileDown,
  BookOpen,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import { useI18n } from "@/i18n";
import type { GuideItem, GuideStep } from "@/lib/content";
import ServiceImportModal from "../ServiceImportModal";
import { ImageUploadField } from "../../ImageUploadField";
import { ImageSlotsEditor } from "../../ImageSlotsEditor";
import type { ServiceParseResult } from "@/lib/servicesImport";

interface GuidesEditorProps {
  guides: GuideItem[];
  onChange: (guides: GuideItem[]) => void;
}

export function GuidesEditor({ guides, onChange }: GuidesEditorProps) {
  const t = useI18n((s) => s.t);
  const [showImportModal, setShowImportModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(guides[0]?.id || null);

  const addGuide = () => {
    const newId = "guide_" + Date.now().toString(36);
    const newGuide: GuideItem = {
      id: newId,
      slug: "guide-" + Date.now(),
      title_ar: "",
      category: "الحسابات والألعاب الرقمية",
      description_ar: "",
      estimated_time: "3 دقائق",
      difficulty: "سهل جداً",
      sort_order: (guides?.length || 0) + 1,
      published: true,
      steps: [
        {
          id: "step_1",
          title_ar: "",
          description_ar: "",
          sort_order: 1,
        },
      ],
    };
    onChange([...(guides || []), newGuide]);
    setExpandedId(newId);
  };

  const updateGuide = (id: string, patch: Partial<GuideItem>) => {
    onChange(guides.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const removeGuide = (id: string) => {
    onChange(guides.filter((g) => g.id !== id));
  };

  const addStep = (guideId: string) => {
    const guide = guides.find((g) => g.id === guideId);
    if (!guide) return;
    const newStep: GuideStep = {
      id: "step_" + Date.now().toString(36),
      title_ar: "",
      description_ar: "",
      sort_order: (guide.steps?.length || 0) + 1,
    };
    updateGuide(guideId, { steps: [...(guide.steps || []), newStep] });
  };

  const updateStep = (guideId: string, stepId: string, patch: Partial<GuideStep>) => {
    const guide = guides.find((g) => g.id === guideId);
    if (!guide) return;
    const updatedSteps = (guide.steps || []).map((s) => (s.id === stepId ? { ...s, ...patch } : s));
    updateGuide(guideId, { steps: updatedSteps });
  };

  const removeStep = (guideId: string, stepId: string) => {
    const guide = guides.find((g) => g.id === guideId);
    if (!guide) return;
    updateGuide(guideId, {
      steps: (guide.steps || []).filter((s) => s.id !== stepId),
    });
  };

  const handleImportResult = (result: ServiceParseResult<GuideItem[]>) => {
    if (result.data && Array.isArray(result.data)) {
      onChange([...(guides || []), ...result.data]);
      const first = result.data[0];
      if (first) {
        setExpandedId(first.id);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-card border border-border p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            {t("أدلة وتعليمات التسجيل")} ({guides?.length || 0})
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("إدارة الشروحات والخطوات المصورة التي تظهر للعملاء في صفحة تعليمات الحسابات.")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-primary/10 text-primary hover:bg-primary/20 rounded-xl transition-colors border border-primary/20"
          >
            <Sparkles className="w-4 h-4" />
            {t("استيراد من قالب")}
          </button>
          <button
            onClick={addGuide}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground hover:opacity-90 rounded-xl transition-all"
          >
            <Plus className="w-4 h-4" />
            {t("إضافة دليل جديد")}
          </button>
        </div>
      </div>

      {/* Guides List */}
      <div className="space-y-4">
        {guides?.map((guide, gIdx) => {
          const isExpanded = expandedId === guide.id;
          return (
            <div
              key={guide.id || gIdx}
              className="bg-card border border-border rounded-2xl overflow-hidden transition-all shadow-sm"
            >
              {/* Summary Bar */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : guide.id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 select-none"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                    {gIdx + 1}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-foreground">
                      {guide.title_ar || t("دليل بدون عنوان")}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span>{guide.category || "عام"}</span>
                      <span>•</span>
                      <span>
                        {guide.steps?.length || 0} {t("خطوات")}
                      </span>
                      <span>•</span>
                      <span>{guide.estimated_time || "3 دقائق"}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeGuide(guide.id);
                    }}
                    className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Expanded Form */}
              {isExpanded && (
                <div className="p-6 border-t border-border bg-muted/10 space-y-6 animate-in fade-in duration-200">
                  {/* Basic Metadata */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold mb-1">
                        {t("عنوان الدليل (عربي)")} *
                      </label>
                      <input
                        type="text"
                        value={guide.title_ar || ""}
                        onChange={(e) => updateGuide(guide.id, { title_ar: e.target.value })}
                        className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:border-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1">{t("التصنيف")}</label>
                      <input
                        type="text"
                        value={guide.category || ""}
                        onChange={(e) => updateGuide(guide.id, { category: e.target.value })}
                        className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:border-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1">
                        {t("الرابط اللطيف (Slug)")}
                      </label>
                      <input
                        type="text"
                        value={guide.slug || ""}
                        onChange={(e) => updateGuide(guide.id, { slug: e.target.value })}
                        className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:border-primary outline-none font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1">{t("الوقت المتوقع")}</label>
                      <input
                        type="text"
                        value={guide.estimated_time || ""}
                        onChange={(e) => updateGuide(guide.id, { estimated_time: e.target.value })}
                        placeholder="مثال: 3 دقائق"
                        className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:border-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1">{t("مستوى الصعوبة")}</label>
                      <input
                        type="text"
                        value={guide.difficulty || ""}
                        onChange={(e) => updateGuide(guide.id, { difficulty: e.target.value })}
                        placeholder="مثال: سهل جداً"
                        className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:border-primary outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <ImageUploadField
                        label={t("صورة توضيحية للدليل (الغلاف)")}
                        value={guide.cover_image || ""}
                        onChange={(url) => updateGuide(guide.id, { cover_image: url })}
                        folder="guides"
                        aspect="banner"
                        helperText={t("تظهر في أعلى الدليل داخل صفحة تعليمات التسجيل.")}
                      />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-xs font-bold mb-1">
                        {t("وصف ومقدمة الدليل")}
                      </label>
                      <textarea
                        value={guide.description_ar || ""}
                        onChange={(e) => updateGuide(guide.id, { description_ar: e.target.value })}
                        rows={2}
                        className="w-full bg-background border border-border rounded-xl p-3 text-sm focus:border-primary outline-none"
                      />
                    </div>
                  </div>

                  {/* Steps Editor */}
                  <div className="space-y-3 pt-4 border-t border-border">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Layers className="w-4 h-4 text-primary" />
                        {t("خطوات الدليل")} ({guide.steps?.length || 0})
                      </h4>
                      <button
                        onClick={() => addStep(guide.id)}
                        className="flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t("إضافة خطوة")}
                      </button>
                    </div>

                    <div className="space-y-3">
                      {guide.steps?.map((step, sIdx) => (
                        <div
                          key={step.id || sIdx}
                          className="bg-card border border-border p-4 rounded-xl space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                                {sIdx + 1}
                              </span>
                              <span className="text-xs font-bold text-muted-foreground">
                                {t("الخطوة")} {sIdx + 1}
                              </span>
                            </div>
                            <button
                              onClick={() => removeStep(guide.id, step.id)}
                              className="p-1 text-rose-500 hover:bg-rose-500/10 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="sm:col-span-2">
                              <input
                                type="text"
                                value={step.title_ar || ""}
                                onChange={(e) =>
                                  updateStep(guide.id, step.id, { title_ar: e.target.value })
                                }
                                placeholder={t("عنوان الخطوة (مثال: إضافة مستخدم جديد)")}
                                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-bold focus:border-primary outline-none"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <textarea
                                value={step.description_ar || ""}
                                onChange={(e) =>
                                  updateStep(guide.id, step.id, { description_ar: e.target.value })
                                }
                                placeholder={t("شرح وتفاصيل الخطوة بالتفصيل...")}
                                rows={2}
                                className="w-full bg-background border border-border rounded-lg p-2.5 text-xs focus:border-primary outline-none"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              {/*
                                Slots, not one field.

                                A step often needs two pictures — the button to
                                press and the dialog it opens — and one field
                                could hold neither with a caption nor an alt
                                text. Each slot also carries a note saying
                                which screenshot belongs there, which is what
                                makes fifty-six of them fillable at all.
                              */}
                              <ImageSlotsEditor
                                images={step.images}
                                onChange={(images) =>
                                  updateStep(guide.id, step.id, { images })
                                }
                                folder="guides"
                                label={t("صور الخطوة")}
                              />
                            </div>
                            <div>
                              <input
                                type="text"
                                value={step.note_ar || ""}
                                onChange={(e) =>
                                  updateStep(guide.id, step.id, { note_ar: e.target.value })
                                }
                                placeholder={t("ملاحظة توضيحية (اختياري)")}
                                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 focus:border-primary outline-none"
                              />
                            </div>
                            <div>
                              <input
                                type="text"
                                value={step.warning_ar || ""}
                                onChange={(e) =>
                                  updateStep(guide.id, step.id, { warning_ar: e.target.value })
                                }
                                placeholder={t("تنبيه أمان (اختياري)")}
                                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 focus:border-primary outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showImportModal && (
        <ServiceImportModal
          type="registration_guides"
          onClose={() => setShowImportModal(false)}
          onImport={handleImportResult}
        />
      )}
    </div>
  );
}
