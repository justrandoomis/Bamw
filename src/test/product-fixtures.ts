/**
 * One fully populated product per non-game category, written as real import
 * templates and run through the real parser.
 *
 * These are fixtures for the acceptance matrix — a used cartridge, a used
 * console, an account bundle, an eShop card, an amiibo, and four accessory
 * subtypes that must each show a different set of fields. Writing them as
 * template text rather than as hand-built objects means a test asserting what
 * the page renders is also asserting that the template parses, that the
 * repeated indices are unbounded, and that the field names in the template
 * still match the ones the view model reads.
 *
 * The values are invented for the fixture. They are never imported by the
 * store — nothing here is a claim about a real product.
 */

import { parseProductImport } from "@/lib/productImport/parser";
import { ACCESSORY_SCHEMA } from "@/lib/productImport/accessorySchema";
import { AMIIBO_SCHEMA } from "@/lib/productImport/amiiboSchema";
import { BUNDLE_SCHEMA } from "@/lib/productImport/bundleSchema";
import { GIFT_CARD_SCHEMA } from "@/lib/productImport/giftCardSchema";
import { USED_SCHEMA } from "@/lib/productImport/usedSchema";
import type { ProductSchema } from "@/lib/productImport/types";

const img = (name: string) => `https://cdn.example.test/${name}.webp`;

const SHARED_MEDIA = [
  `main_image=${img("main")}`,
  `listing_image=${img("listing")}`,
  `front_image=${img("front")}`,
  `packaging_front_image=${img("pack-front")}`,
  `gallery.1.image=${img("g1")}`,
  `gallery.1.title=زاوية جانبية`,
  // Deliberately far past the four rows the template prints as examples.
  `gallery.12.image=${img("g12")}`,
].join("\n");

const SHARED_SOURCES = [
  "source.1.name=Nintendo",
  "source.1.url=https://www.nintendo.com/",
  "source.1.type=manufacturer",
  "source.2.name=Nintendo Support",
  "source.2.url=https://en-americas-support.nintendo.com/",
  "source.2.type=official_support",
].join("\n");

const TEMPLATES: Record<string, { section: string; schema: ProductSchema; text: string }> = {
  used_cartridge: {
    section: "used",
    schema: USED_SCHEMA,
    text: `
schema_version=2
name=Mario Kart 8 Deluxe (شريط مستعمل)
used_type=cartridge
original_title=Mario Kart 8 Deluxe
platform=Nintendo Switch
condition_grade=very_good
packaging=cib
guarantee_status=tested_14days
tested=true
tested_at=2026-03-04
cleaned=true
previous_owners=1
condition_notes<<EOF
الشريط يعمل بشكل كامل. العلبة عليها خدش سطحي في الزاوية العلوية.
EOF
defect.1=خدش سطحي على العلبة
defect.2=الملصق الخلفي مرفوع قليلاً من الحافة
inspection_point.1=تشغيل اللعبة حتى القائمة الرئيسية
inspection_point.2=قراءة الشريط في جهازين مختلفين
inspection_point.3=فحص الملصق الأصلي
inspection_point.7=تنظيف نقاط التلامس
description_ar<<EOF
نسخة مستعملة مفحوصة من Mario Kart 8 Deluxe بحالة جيدة جداً وبكامل العلبة والكتيّب.
EOF
description_en<<EOF
A tested pre-owned copy of Mario Kart 8 Deluxe, complete in box.
EOF
box_content.1.name=شريط اللعبة
box_content.1.quantity=1
box_content.2.name=العلبة الأصلية
box_content.2.quantity=1
faq.1.question=هل الشريط يعمل على Nintendo Switch 2؟
faq.1.answer=نعم، أشرطة Nintendo Switch تعمل على Nintendo Switch 2.
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  used_console: {
    section: "used",
    schema: USED_SCHEMA,
    text: `
schema_version=2
name=Nintendo Switch OLED (جهاز مستعمل)
used_type=console
original_title=Nintendo Switch OLED Model
platform=Nintendo Switch
condition_grade=good
packaging=boxed_no_manual
guarantee_status=tested_30days
tested=true
tested_at=2026-02-18
cleaned=true
previous_owners=2
usage_period_months=14
condition_notes<<EOF
الشاشة سليمة بلا بقع. الظهر عليه علامات استخدام خفيفة. البطارية تعطي نحو أربع ساعات ونصف.
EOF
defect.1=علامات استخدام خفيفة على الغطاء الخلفي
defect.2=المسند الخلفي أقل ثباتاً من الجديد
inspection_point.1=فحص البكسلات الميتة
inspection_point.2=اختبار جميع الأزرار والعصي
inspection_point.3=قياس زمن البطارية
inspection_point.4=اختبار قاعدة الشحن ومخرج HDMI
inspection_point.5=اختبار قارئ بطاقة microSD
product_weight=420
product_dimensions=242 × 102 × 13.9 mm
description_ar<<EOF
جهاز Nintendo Switch OLED مستعمل، تم فحصه بالكامل وتنظيفه، ويأتي بضمان متجر لمدة 30 يوماً بعد الفحص.
EOF
warranty=30 يوماً ضمان متجر بعد الفحص
box_content.1.name=الجهاز
box_content.1.quantity=1
box_content.2.name=قاعدة الشحن
box_content.2.quantity=1
box_content.3.name=Joy-Con يمين ويسار
box_content.3.quantity=2
box_content.4.name=كابل HDMI
box_content.4.quantity=1
setup_step.1=افحص الجهاز عند الاستلام
setup_step.2=اشحن الجهاز بالكامل قبل أول استخدام
spec_group.1.name=البطارية
spec_group.1.spec.1.name=زمن التشغيل المقاس
spec_group.1.spec.1.value=4.5
spec_group.1.spec.1.unit=h
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  bundle: {
    section: "bundle",
    schema: BUNDLE_SCHEMA,
    text: `
schema_version=2
name=حزمة ماريو الكبرى
account_type=primary
platform=Nintendo Switch
games_count=3
devices_limit=1
online_play=true
delivery_time=خلال ساعة
bundle_games_summary<<EOF
ثلاث ألعاب ماريو على حساب أساسي واحد.
EOF
bundle_item.1.title=Super Mario Odyssey
bundle_item.1.platform=Nintendo Switch
bundle_item.1.value_iqd=45000
bundle_item.2.title=Mario Kart 8 Deluxe
bundle_item.2.platform=Nintendo Switch
bundle_item.2.value_iqd=52000
bundle_item.9.title=Super Mario Bros. Wonder
bundle_item.9.platform=Nintendo Switch
bundle_item.9.value_iqd=58000
included_service.1=دعم فني طوال فترة الاستخدام
included_service.2=استبدال الحساب عند التعطل
account_terms<<EOF
الحساب مخصص لجهاز واحد. لا تغيّر كلمة المرور.
EOF
description_ar<<EOF
حزمة ثلاث ألعاب ماريو على حساب أساسي بسعر أقل من شرائها منفردة.
EOF
setup_step.1=استلم بيانات الحساب بعد الشراء
setup_step.2=سجّل الدخول من إعدادات الجهاز
setup_step.3=نزّل الألعاب من قائمة المشتريات
faq.1.question=هل أستطيع اللعب أونلاين؟
faq.1.answer=نعم، على الحساب الأساسي.
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  gift_card: {
    section: "gift_card",
    schema: GIFT_CARD_SCHEMA,
    text: `
schema_version=2
name=بطاقة Nintendo eShop بقيمة 20 دولاراً
card_type=eshop
card_value=20
card_currency=USD
card_region=US
region_locked=true
platform=Nintendo Switch
code_length=16 خانة
validity=no_expiry
delivery_method=instant_code
delivery_time=فوري
redemption_url=https://ec.nintendo.com/redeem
redeem_step.1=افتح متجر Nintendo eShop من جهازك
redeem_step.2=اختر حسابك ثم "Redeem Code"
redeem_step.3=أدخل الكود المكوّن من 16 خانة
redeem_step.4=تأكد من إضافة الرصيد إلى المحفظة
redeem_step.9=راجع سجل المشتريات للتأكد
requirement.1=حساب Nintendo أمريكي
requirement.2=اتصال بالإنترنت
requirement.3=رصيد البطاقة يُضاف بالدولار الأمريكي فقط
refund_policy<<EOF
لا يمكن استرجاع الكود بعد إرساله.
EOF
usage_terms<<EOF
الكود صالح للاستخدام مرة واحدة على حساب أمريكي.
EOF
description_ar<<EOF
بطاقة شحن رصيد Nintendo eShop بقيمة 20 دولاراً للحسابات الأمريكية، تصل فوراً بعد الشراء.
EOF
card_artwork=${img("card-art")}
region_banner=${img("region-us")}
faq.1.question=هل تعمل على حساب أوروبي؟
faq.1.answer=لا، البطاقة مقيدة بالريجون الأمريكي.
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  amiibo: {
    section: "amiibo",
    schema: AMIIBO_SCHEMA,
    text: `
schema_version=2
name=amiibo Link — The Legend of Zelda
official_name=Link (Tears of the Kingdom)
character=Link
franchise=The Legend of Zelda
amiibo_series=The Legend of Zelda
figure_type=amiibo
edition=standard
rarity=uncommon
production_status=in_production
collection_number=03
release_wave=Tears of the Kingdom
release_date=2023-05-12
nfc_support=true
amiibo_functionality<<EOF
يمنح عناصر داخل اللعبة مرة واحدة يومياً، وقد يمنح قطعاً من أزياء خاصة.
EOF
character_description<<EOF
Link هو بطل سلسلة The Legend of Zelda، ويظهر في هذا المجسم بزي Tears of the Kingdom.
EOF
compatible_console.1=Nintendo Switch
compatible_console.2=Nintendo Switch 2
compatible_console.3=Wii U
game_compatibility.1.game=The Legend of Zelda: Tears of the Kingdom
game_compatibility.1.platform=Nintendo Switch
game_compatibility.1.function=استدعاء عناصر
game_compatibility.1.reward=قطعة زي أو مادة
game_compatibility.2.game=The Legend of Zelda: Breath of the Wild
game_compatibility.2.platform=Nintendo Switch
game_compatibility.2.function=استدعاء عناصر
game_compatibility.2.reward=طعام أو سلاح
game_compatibility.14.game=Super Smash Bros. Ultimate
game_compatibility.14.platform=Nintendo Switch
game_compatibility.14.function=مقاتل مساعد
game_compatibility.14.reward=مقاتل قابل للتدريب
product_height=105
material.1=PVC
material.2=ABS
collector_notes<<EOF
يُنصح بحفظ المجسم بعيداً عن أشعة الشمس المباشرة.
EOF
description_ar<<EOF
مجسم amiibo رسمي لشخصية Link من The Legend of Zelda، يدعم NFC ويعمل مع عدة ألعاب.
EOF
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  accessory_controller: {
    section: "accessory",
    schema: ACCESSORY_SCHEMA,
    text: `
schema_version=2
name=ذراع تحكم لاسلكي احترافي
accessory_type=controller
brand=Nintendo
wireless=true
bluetooth_version=5.0
battery_capacity=1300
battery_life=40
hall_effect=true
motion_controls=true
hd_rumble=true
polling_rate=1000
compatibility.1.name=Nintendo Switch
compatibility.1.status=compatible
compatibility.2.name=Nintendo Switch 2
compatibility.2.status=compatible
compatibility.3.name=PC (Windows)
compatibility.3.status=partial
compatibility.3.notes=يحتاج برنامج وسيط لبعض الألعاب
compatibility.11.name=macOS
compatibility.11.status=unverified
feature.1=عصي Hall Effect بلا انجراف
feature.2=بطارية تدوم حتى 40 ساعة
feature.3=استجابة 1000Hz سلكياً
box_content.1.name=الذراع
box_content.1.quantity=1
box_content.2.name=كابل USB-C
box_content.2.quantity=1
warranty=سنة واحدة
product_weight=246
description_ar<<EOF
ذراع تحكم لاسلكي بعصي Hall Effect وبطارية طويلة العمر، متوافق مع Nintendo Switch وSwitch 2.
EOF
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  accessory_charger: {
    section: "accessory",
    schema: ACCESSORY_SCHEMA,
    text: `
schema_version=2
name=شاحن GaN بقدرة 65 واط
accessory_type=charger
brand=Anker
maximum_wattage=65
usb_pd=true
gan=true
port_count=2
plug_type=Type G
cable_included=true
compatibility.1.name=Nintendo Switch
compatibility.1.status=compatible
compatibility.2.name=Nintendo Switch 2
compatibility.2.status=compatible
feature.1=شحن سريع عبر USB-C PD
feature.2=حجم أصغر بتقنية GaN
box_content.1.name=الشاحن
box_content.1.quantity=1
warranty=سنتان
description_ar<<EOF
شاحن GaN بقدرة 65 واط بمنفذين، يدعم USB-C Power Delivery.
EOF
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  accessory_storage: {
    section: "accessory",
    schema: ACCESSORY_SCHEMA,
    text: `
schema_version=2
name=بطاقة microSD Express بسعة 256GB
accessory_type=storage
brand=SanDisk
capacity=256
storage_type=microSD Express
interface=microSD Express
read_speed=880
write_speed=650
speed_class=Class 10 / U3 / V30
compatibility.1.name=Nintendo Switch 2
compatibility.1.status=compatible
compatibility.2.name=Nintendo Switch
compatibility.2.status=requires_adapter
compatibility.2.notes=تعمل بسرعة microSD UHS-I فقط
feature.1=سرعة قراءة تصل إلى 880 ميغابايت/ثانية
feature.2=مصممة لمتطلبات Nintendo Switch 2
warranty=ضمان محدود
description_ar<<EOF
بطاقة microSD Express بسعة 256 غيغابايت مخصصة لـ Nintendo Switch 2.
EOF
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },

  accessory_case: {
    section: "accessory",
    schema: ACCESSORY_SCHEMA,
    text: `
schema_version=2
name=حقيبة حماية صلبة
accessory_type=case
brand=Nintendo
protection_type=قشرة صلبة EVA
drop_protection=حتى 1.2 متر
water_resistance=مقاومة للرذاذ
dust_protection=سحّاب مزدوج
game_card_slots=10
compartments=2
handle=true
material=EVA + نايلون
compatibility.1.name=Nintendo Switch OLED
compatibility.1.status=compatible
compatibility.2.name=Nintendo Switch 2
compatibility.2.status=compatible
feature.1=عشر فتحات للأشرطة
feature.2=بطانة داخلية ناعمة
box_content.1.name=الحقيبة
box_content.1.quantity=1
description_ar<<EOF
حقيبة حماية صلبة بعشر فتحات للأشرطة وبطانة داخلية ناعمة.
EOF
${SHARED_MEDIA}
${SHARED_SOURCES}
`,
  },
};

export interface ProductFixture {
  section: string;
  schema: ProductSchema;
  product: Record<string, unknown>;
  /** Parser issues, so a test can assert the fixture template is itself valid. */
  errors: { key: string; message: string; severity: string }[];
}

export const FIXTURES: Record<string, ProductFixture> = Object.fromEntries(
  Object.entries(TEMPLATES).map(([id, { section, schema, text }]) => {
    const parsed = parseProductImport(text, schema);
    return [
      id,
      {
        section,
        schema,
        errors: parsed.errors,
        product: {
          ...parsed.data,
          id: `prd_${id}`,
          slug: id.replace(/_/g, "-"),
          schemaId: schema.id,
          kind: schema.kind,
          category: schema.categoryId,
          price: 25000,
          stock: 5,
        },
      },
    ];
  }),
);

export const FIXTURE_IDS = Object.keys(FIXTURES);
