/**
 * The seller types a handle; the shop builds the link.
 *
 * Two things are being held here. The first is convenience: people write the
 * same account four different ways, and all four should reach it. The second
 * is that this value comes from a member and ends up in an `href` on a public
 * page — so the link is always *built* from a validated handle and never taken
 * from what was typed.
 */
import { describe, expect, it } from "vitest";

import { buildContactLink, buildContactLinks, normalizeContact } from "@/lib/contact-links";

describe("telegram", () => {
  it("takes a bare handle", () => {
    expect(buildContactLink("telegram", "ali_gamer")?.href).toBe("https://t.me/ali_gamer");
  });

  it("takes it with an @", () => {
    expect(buildContactLink("telegram", "@ali_gamer")?.href).toBe("https://t.me/ali_gamer");
  });

  it("takes a pasted profile link", () => {
    expect(buildContactLink("telegram", "https://t.me/ali_gamer")?.href).toBe(
      "https://t.me/ali_gamer",
    );
  });

  it("takes one without the scheme, and drops a trailing slash", () => {
    expect(buildContactLink("telegram", "t.me/ali_gamer/")?.href).toBe("https://t.me/ali_gamer");
  });

  it("drops a query string rather than carrying it into the link", () => {
    expect(buildContactLink("telegram", "https://t.me/ali_gamer?start=ref")?.href).toBe(
      "https://t.me/ali_gamer",
    );
  });

  it("refuses a handle too short to be one", () => {
    expect(buildContactLink("telegram", "ab")).toBeNull();
  });
});

describe("a phone number, however it is written", () => {
  it("takes a local Iraqi number", () => {
    expect(buildContactLink("whatsapp", "07701234567")?.href).toBe("https://wa.me/9647701234567");
  });

  it("takes it with the country code and spaces", () => {
    expect(buildContactLink("whatsapp", "+964 770 123 4567")?.href).toBe(
      "https://wa.me/9647701234567",
    );
  });

  it("takes it typed in Arabic digits", () => {
    /* ٠٧٧٠١٢٣٤٥٦٧ — the way a phone keypad in Arabic produces it. */
    expect(buildContactLink("whatsapp", "٠٧٧٠١٢٣٤٥٦٧")?.href).toBe("https://wa.me/9647701234567");
  });

  it("builds a dialable link for the phone channel, not a web one", () => {
    expect(buildContactLink("phone", "07701234567")?.href).toBe("tel:+9647701234567");
  });

  it("takes a pasted wa.me link", () => {
    expect(buildContactLink("whatsapp", "https://wa.me/9647701234567")?.href).toBe(
      "https://wa.me/9647701234567",
    );
  });

  it("refuses something that is not a number", () => {
    expect(buildContactLink("whatsapp", "call me")).toBeNull();
  });
});

describe("instagram and facebook", () => {
  it("takes an instagram handle with dots", () => {
    expect(buildContactLink("instagram", "@ali.gamer")?.href).toBe(
      "https://instagram.com/ali.gamer",
    );
  });

  it("takes a pasted instagram link", () => {
    expect(buildContactLink("instagram", "instagram.com/ali.gamer")?.href).toBe(
      "https://instagram.com/ali.gamer",
    );
  });

  it("takes a facebook vanity name", () => {
    expect(buildContactLink("facebook", "ali.gamer.99")?.href).toBe(
      "https://facebook.com/ali.gamer.99",
    );
  });

  it("takes a numeric facebook profile id out of a profile.php link", () => {
    /*
      The path here is the script, not the handle — the profile is the id. I
      wrote this test asserting the wrong answer first, and it passed against a
      link that had silently dropped the id and pointed at facebook.com itself.
    */
    expect(
      buildContactLink("facebook", "https://facebook.com/profile.php?id=100001234567")?.href,
    ).toBe("https://facebook.com/100001234567");
  });

  it("refuses profile.php with no id, rather than linking to the script", () => {
    expect(buildContactLink("facebook", "https://facebook.com/profile.php")).toBeNull();
  });
});

describe("what it refuses, because this becomes an href on a public page", () => {
  it("refuses a javascript: url", () => {
    expect(buildContactLink("instagram", "javascript:alert(1)")).toBeNull();
    expect(buildContactLink("telegram", "javascript:alert(1)")).toBeNull();
  });

  it("refuses a link to somewhere that is not the platform", () => {
    /*
      The whole point. This reads as an Instagram profile and is not one; the
      host is checked before the path is ever treated as a handle.
    */
    expect(buildContactLink("instagram", "https://evil.example/ali.gamer")).toBeNull();
    expect(buildContactLink("telegram", "https://evil.example/ali_gamer")).toBeNull();
  });

  it("refuses a data: url", () => {
    expect(buildContactLink("telegram", "data:text/html,<script>x</script>")).toBeNull();
  });

  it("refuses a handle carrying characters the platform does not allow", () => {
    expect(buildContactLink("telegram", "ali gamer")).toBeNull();
    expect(buildContactLink("instagram", "ali/../../etc")).toBeNull();
    expect(buildContactLink("telegram", "ali<script>")).toBeNull();
  });

  it("refuses a deeper path that is not a profile", () => {
    expect(buildContactLink("instagram", "https://instagram.com/ali/p/12345")).toBeNull();
  });

  it("never returns an href it did not build itself", () => {
    /* Every accepted input produces a link starting with a known prefix. */
    const accepted = [
      buildContactLink("telegram", "@ali_gamer"),
      buildContactLink("instagram", "ali.gamer"),
      buildContactLink("facebook", "ali.gamer.99"),
      buildContactLink("whatsapp", "07701234567"),
      buildContactLink("phone", "07701234567"),
    ].filter(Boolean);
    expect(accepted).toHaveLength(5);
    for (const link of accepted) {
      expect(link!.href).toMatch(
        /^(https:\/\/(t\.me|instagram\.com|facebook\.com|wa\.me)\/|tel:\+)/,
      );
    }
  });
});

describe("the whole contact block", () => {
  it("keeps a fixed order, so buttons do not reshuffle between listings", () => {
    const links = buildContactLinks({
      instagram: "ali.gamer",
      telegram: "ali_gamer",
      phone: "07701234567",
    });
    expect(links.map((l) => l.channel)).toEqual(["telegram", "phone", "instagram"]);
  });

  it("skips a field left blank rather than drawing a dead button", () => {
    const links = buildContactLinks({ telegram: "ali_gamer", instagram: "", facebook: "   " });
    expect(links.map((l) => l.channel)).toEqual(["telegram"]);
  });

  it("skips a field filled in with something unusable", () => {
    const links = buildContactLinks({ telegram: "ali_gamer", whatsapp: "ping me" });
    expect(links.map((l) => l.channel)).toEqual(["telegram"]);
  });

  it("stores the cleaned handle, not what was typed", () => {
    expect(
      normalizeContact({ telegram: "https://t.me/ali_gamer?start=x", whatsapp: "٠٧٧٠١٢٣٤٥٦٧" }),
    ).toEqual({ telegram: "ali_gamer", whatsapp: "+9647701234567" });
  });

  it("stores nothing for a block with nothing usable in it", () => {
    expect(normalizeContact({ telegram: "a", facebook: "javascript:x" })).toEqual({});
  });

  it("ignores a key that is not a channel", () => {
    expect(normalizeContact({ email: "a@b.c", telegram: "ali_gamer" })).toEqual({
      telegram: "ali_gamer",
    });
  });
});
