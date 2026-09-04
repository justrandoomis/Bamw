// @vitest-environment node
/**
 * What the guide page owes a customer, checked on the server-rendered HTML.
 *
 * Server-rendered on purpose: this page is reached from a delivery card, a
 * Telegram reply and a search result, and each of those needs the text to be
 * in the first response — for the browser's own find-in-page, for a link
 * preview, and for somebody on a slow connection who will not wait for
 * hydration to read step one.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GuidesView } from "./GuidesView";
import { applyGuideOverrides, shippedGuides } from "@/lib/siteGuides";
import type { GuideItem } from "@/lib/content";

const guides = applyGuideOverrides(shippedGuides(), []);
const html = renderToStaticMarkup(<GuidesView guides={guides} />);

describe("the rendered manual", () => {
  it("puts every guide behind a stable fragment a link can hold", () => {
    for (const slug of [
      "login-method-1",
      "login-method-2",
      "resend-verification",
      "online-license",
      "download-game",
      "offline-play",
      "online-play",
    ]) {
      expect(html, slug).toContain(`id="${slug}"`);
    }
  });

  it("offers those sections as jumps at the top", () => {
    expect(html).toContain('href="#login-method-1"');
    expect(html).toContain('href="#online-license"');
    expect(html).toContain('href="#offline-play"');
  });

  it("says the one thing customers get wrong, once", () => {
    const occurrences = html.split("الاختلاف يظهر عند تشغيل اللعبة فقط").length - 1;
    expect(occurrences).toBe(1);
  });

  it("carries the instruction the shop actually gives", () => {
    expect(html).toContain("Forgot your password");
    expect(html).toContain("أرسل صورة");
  });

  it("numbers the steps rather than leaving a wall of text", () => {
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
  });

  it("names the Nintendo menus in English beside the Arabic", () => {
    for (const label of ["Nintendo eShop", "Link a Nintendo Account", "Download Data"]) {
      expect(html, label).toContain(label);
    }
  });
});

describe("a slot with nothing in it", () => {
  it("renders no image element at all", () => {
    /*
      Not a placeholder, not a broken image, not a gap. Every step ships with a
      slot so the admin screen can ask for a screenshot; until one exists the
      customer's page must read as though the step never had a picture.
    */
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<figure");
  });

  it("never leaks the admin's note about which picture belongs there", () => {
    expect(html).not.toContain("أضف صورة الخطوة");
  });
});

describe("a slot the shop owner has filled", () => {
  const withPicture: GuideItem[] = [
    {
      ...guides.find((guide) => guide.id === "download_game")!,
      steps: [
        {
          id: "step_01",
          title_ar: "افتح Virtual Game Cards",
          description_ar: "",
          sort_order: 1,
          images: [
            {
              id: "a",
              url: "/api/files/content/vgc.webp",
              alt: "أيقونة Virtual Game Cards",
              caption: "الأيقونة قرب الإعدادات",
              sort_order: 1,
            },
            { id: "b", url: "", hint: "لم تُرفع بعد", alt: "", sort_order: 2 },
          ],
        },
      ],
    },
  ];
  const filled = renderToStaticMarkup(<GuidesView guides={withPicture} />);

  it("shows it", () => {
    expect(filled).toContain('src="/api/files/content/vgc.webp"');
  });

  it("describes it for a reader who cannot see it", () => {
    expect(filled).toContain('alt="أيقونة Virtual Game Cards"');
  });

  it("shows the caption the admin wrote", () => {
    expect(filled).toContain("الأيقونة قرب الإعدادات");
  });

  it("still renders nothing for the slot beside it that is empty", () => {
    expect(filled.split("<img").length - 1).toBe(1);
  });

  it("never stretches or crops it", () => {
    // `h-auto` with `w-full`: the picture fits its column and keeps its shape.
    expect(filled).toContain("h-auto");
    expect(filled).not.toContain("object-cover");
  });
});

describe("an empty manual", () => {
  it("says so rather than rendering a blank page", () => {
    const empty = renderToStaticMarkup(<GuidesView guides={[]} />);
    expect(empty).toContain("لا توجد أدلة منشورة");
  });
});
