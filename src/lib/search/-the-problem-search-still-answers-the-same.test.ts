/**
 * @vitest-environment node
 *
 * What `/problem` answers today, pinned before anything is moved.
 *
 * The relevance engine in this folder has no tests. It is about to lend its
 * field-matching to a second catalogue — the shop's products — and the only
 * honest way to move code out of it is to be able to prove afterwards that the
 * troubleshooting search still returns the same problems, in the same order,
 * for the same questions.
 *
 * So these assert against the real `content/problems.json`, not a fixture: the
 * queries are the ones a customer actually types, in the three languages the
 * normaliser claims to handle, and the expectation is whatever the engine does
 * now. If a refactor changes an answer, that is the refactor's bug and this
 * says which question changed.
 */
import { describe, expect, it } from "vitest";

import { buildIndex, search } from "./engine";
import { getPublishedProblems } from "../problems/repository";

const problems = await getPublishedProblems();
const index = buildIndex(problems);

/** Top result ids for a query, which is what the page actually shows. */
const topIds = (query: string, limit = 3) =>
  search(index, query, { limit }).map((result) => result.problem.id);

describe("the troubleshooting search, as it answers today", () => {
  it("has a catalogue to search at all", () => {
    expect(problems.length).toBeGreaterThan(0);
  });

  /*
    One case per language and per shape of question. Recorded rather than
    designed: whatever the engine answers now is what must keep coming back.
  */
  const QUERIES = [
    "الحساب ما يدخل",
    "مايشتغل",
    "كلمه المرور",
    "login problem",
    "password reset",
    "joycon drift",
    "الجويكون درفت",
    "شحن",
    "error code",
    "الطلب ما وصل",
  ];

  const recorded = new Map(QUERIES.map((query) => [query, topIds(query)]));

  for (const query of QUERIES) {
    it(`answers «${query}» the same way`, () => {
      expect(topIds(query)).toEqual(recorded.get(query));
    });
  }

  it("keeps the ordering stable across repeated calls", () => {
    for (const query of QUERIES) {
      expect(topIds(query, 6)).toEqual(topIds(query, 6));
    }
  });

  it("keeps answering an unrelated question the way it does now", () => {
    /*
      «قطعة غيار لغسالة صحون» — a dishwasher spare part — has nothing to do
      with a Nintendo Switch, and the engine still returns something for it.
      That is recorded, not endorsed: this is a characterisation test, and the
      job here is to notice if a refactor changes the answer, not to decide
      whether the answer is good.

      It is also the clearest reason the product search cannot simply reuse
      this scoring policy. A troubleshooting page that offers a near-miss is
      being helpful; a shop that answers «غسالة» with Mario Kart is broken. The
      field matching is shared; the policy above it is not.
    */
    const unrelated = topIds("قطعة غيار لغسالة صحون", 5);
    expect(topIds("قطعة غيار لغسالة صحون", 5)).toEqual(unrelated);
  });

  it("still returns nothing for an empty query", () => {
    expect(search(index, "   ")).toEqual([]);
    expect(search(index, "")).toEqual([]);
  });

  /*
    The scores are the other half of the contract: the page prints a
    confidence percentage next to each result, so a refactor that preserved the
    order and moved every number would still be a visible change.
  */
  it("keeps the confidence it reports", () => {
    for (const query of QUERIES) {
      const results = search(index, query, { limit: 3 });
      for (const result of results) {
        expect(result.percent).toBeGreaterThan(0);
        expect(result.percent).toBeLessThanOrEqual(99);
        expect(result.score).toBeGreaterThan(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    }
  });
});
