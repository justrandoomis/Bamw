/**
 * Used & pre-owned schema.
 *
 * The only questions that matter for a second-hand item are: what exactly is
 * being sold, what condition is it in, what is in the box, and what protection
 * the buyer gets. Everything here is written for that, not for spec sheets.
 */

import {
  classify,
  boxContentField,
  descriptionFields,
  f,
  identityFields,
  mediaFields,
  physicalFields,
  relatedField,
  seoFields,
  fieldSourceFields,
  sourceField,
  specGroupField,
  warrantyFields,
} from "./shared";
import type { FieldDef, ProductSchema } from "./types";

const ITEM = "القطعة المستعملة";
const CONDITION = "الحالة والفحص";

/*
  Which kinds a field belongs to.

  The editor already knows how to hide a field that does not apply — it is how
  a charger avoids being asked about Hall-effect sticks — but the used schema
  never told it anything, so every kind was asked every question. A figurine
  was asked for its platform, its previous owners and which inspection points
  passed; a cartridge was asked how many months of warranty were left on it.

  HARDWARE is the set that can be powered on, worn out and warranted. PLAYABLE
  adds the cartridge: it has a platform and a box, but no service life worth
  stating and nothing to inspect beyond «does it read».
*/
const HARDWARE = ["console", "controller", "accessory", "bundle"];
const PLAYABLE = ["cartridge", ...HARDWARE];

export const USED_TYPE_VALUES = [
  "cartridge",
  "console",
  "controller",
  "accessory",
  "amiibo",
  /*
    A figurine that is not an amiibo — a statue, a boxed figure, a keyring.
    The owner listed «مجسم» beside game, device and accessory as one of the
    things a member would come to sell, and every one of those was arriving
    tagged `accessory` because there was nowhere else to put it.
  */
  "collectible",
  "bundle",
] as const;

export const CONDITION_GRADE_VALUES = [
  "like_new",
  "excellent",
  "very_good",
  "good",
  "acceptable",
  "for_parts",
] as const;

export const PACKAGING_VALUES = ["cib", "boxed_no_manual", "loose", "sealed"] as const;

export const GUARANTEE_VALUES = [
  "tested_30days",
  "tested_14days",
  "tested_7days",
  "tested_only",
  "as_is",
] as const;

const item: FieldDef[] = [
  {
    key: "used_type",
    type: "enum",
    target: "usedType",
    required: true,
    enumValues: USED_TYPE_VALUES,
    description: `نوع القطعة: ${USED_TYPE_VALUES.join(" / ")}`,
    group: ITEM,
  },
  f.str("original_title", "originalTitle", "الاسم الأصلي للقطعة/اللعبة — لا يُترجم", {
    group: ITEM,
  }),
  {
    ...f.str("platform", "platform", "المنصة (Nintendo Switch، Switch 2…)", {
      specKey: "platform",
      group: ITEM,
    }),
    showFor: PLAYABLE,
  },
  {
    ...f.str("serial_number", "serialNumber", "الرقم التسلسلي إن وُجد", { group: ITEM }),
    showFor: ["console", "controller"],
  },
  {
    ...f.num("usage_period_months", "usagePeriodMonths", "مدة الاستخدام السابقة", {
      unit: "months",
      specKey: "usagePeriodMonths",
      group: ITEM,
    }),
    showFor: HARDWARE,
  },
  {
    ...f.num("previous_owners", "previousOwners", "عدد الملاك السابقين", {
      specKey: "previousOwners",
      group: ITEM,
    }),
    showFor: HARDWARE,
  },
];

const condition: FieldDef[] = [
  {
    key: "condition_grade",
    type: "enum",
    target: "conditionGrade",
    required: true,
    enumValues: CONDITION_GRADE_VALUES,
    description: `درجة الحالة: ${CONDITION_GRADE_VALUES.join(" / ")}`,
    group: CONDITION,
  },
  {
    key: "packaging",
    type: "enum",
    target: "packaging",
    enumValues: PACKAGING_VALUES,
    description: `حالة التغليف: ${PACKAGING_VALUES.join(" / ")}`,
    group: CONDITION,
  },
  {
    key: "guarantee_status",
    type: "enum",
    target: "guaranteeStatus",
    enumValues: GUARANTEE_VALUES,
    description: `الضمان بعد الفحص: ${GUARANTEE_VALUES.join(" / ")}`,
    group: CONDITION,
    showFor: PLAYABLE,
  },
  f.text("condition_notes", "conditionNotes", "ملاحظات الحالة بصدق (خدوش، علامات استخدام…)", {
    group: CONDITION,
  }),
  f.bool("tested", "tested", "تم فحص القطعة (true/false)", {
    specKey: "tested",
    group: CONDITION,
  }),
  f.date("tested_at", "testedAt", "تاريخ الفحص YYYY-MM-DD", { group: CONDITION }),
  f.bool("cleaned", "cleaned", "تم التنظيف والتعقيم (true/false)", {
    specKey: "cleaned",
    group: CONDITION,
  }),
  {
    key: "defect",
    type: "string",
    target: "defects",
    repeatable: true,
    templateCount: 4,
    description: "العيوب المعروفة — اذكرها كاملة",
    group: CONDITION,
  },
  {
    key: "inspection_point",
    type: "string",
    target: "inspectionPoints",
    repeatable: true,
    templateCount: 5,
    description: "نقاط الفحص التي تمت (تشغيل، أزرار، شاشة، بطارية…)",
    group: CONDITION,
    showFor: HARDWARE,
  },
];

export const USED_SCHEMA: ProductSchema = {
  id: "used",
  version: 2,
  label: "المستعمل",
  labelKey: "category.used",
  categoryId: "cat_used",
  kind: "used",
  templateFile: "used-product-template.txt",
  /*
    Everything with a `showFor` above is read against this field, which is why
    it is required: with no kind chosen the editor shows the shared fields only
    and asks nothing kind-specific.
  */
  conditionalOn: "used_type",
  fields: classify(
    [
      ...identityFields("اسم القطعة المستعملة"),
      ...descriptionFields(),
      ...item,
      ...condition,
      ...physicalFields(),
      specGroupField(),
      boxContentField(),
      ...warrantyFields(),
      ...mediaFields(),
      /*
        Setup steps, purchase options and critic scores are gone.

        They describe a product the shop stocks: how to set a new console up,
        which edition to buy, what the reviews said. A used listing is one
        specific physical object somebody already owns — it has no variants to
        pick between, and a critic score belongs on the game, not on this
        scratched copy of it. Between them they were roughly a third of the
        form the owner said had too much in it.
      */
      relatedField(),
      sourceField(),
      ...fieldSourceFields(),
      ...seoFields(),
    ],
    {
      required: ["name", "used_type", "condition_grade", "tested", "condition_notes"],
      recommended: [
        "original_title",
        "platform",
        "packaging",
        "guarantee_status",
        "defect",
        "inspection_point",
        "tested_at",
        "cleaned",
        "description_ar",
        "description_short",
        "main_image",
        "listing_image",
        "front_image",
        "back_image",
        "close_up_image",
        "box_content",
        "warranty",
        "source",
        "previous_owners",
      ],
      internal: [
        "search_keywords",
        "seo_title",
        "seo_description",
        "og_image",
        "og_title",
        "og_description",
        "serial_number",
      ],
    },
  ),
};
