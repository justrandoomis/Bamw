/**
 * @vitest-environment node
 */
/**
 * «يرجى التقييم للحصول على كود خصم ألف دينار» — and the code has to be earned.
 *
 * Production showed what the old rule did: 27 completed orders, 27 rewards, 23
 * customers. Every completion minted a code whether or not anyone wrote a
 * word. What is asserted here is the shape of the new rule, in the places it
 * would quietly come undone:
 *
 *   - the weekly gate is a compare-and-set, not a read then a write
 *   - a failed mint gives the week back
 *   - the minute cron cannot publish a submission as approved
 *   - one submission covers every product in the order
 *   - nothing mints on submission, only on an admin's approval
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const reward = read("src/lib/review-reward.server.ts");
const reviews = read("src/lib/reviews.server.ts");
const reviewsRoute = read("src/routes/api/reviews.ts");
const orderReviewRoute = read("src/routes/api/order-review.ts");
const adminRoute = read("src/routes/api/admin/review-submissions.ts");
const sheet = read("src/components/reviews/OrderReviewSheet.tsx");
const panel = read("src/components/admin/inbox/ReviewApprovalPanel.tsx");
const customerList = read("src/components/admin/inbox/CustomerList.tsx");
const inboxView = read("src/components/admin/inbox/AdminInboxView.tsx");

/** The body of one function, so an assertion cannot pass on a neighbour's code. */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport ", start + signature.length);
  return source.slice(start, next > start ? next : source.length);
}

describe("the weekly gate", () => {
  const gate = bodyOf(reward, "export async function issueApprovedReviewReward");

  it("claims the week with a compare-and-set, not a read then a write", () => {
    /*
      Two admins approving two reviews by the same customer in the same second
      must not both win. A SELECT followed by an INSERT has a window between
      them where they both would; the `WHERE` on the upsert does not.
    */
    expect(gate).toContain("INSERT INTO review_reward_cooldowns");
    expect(gate).toContain("ON CONFLICT(user_id) DO UPDATE SET");
    expect(gate).toContain("WHERE review_reward_cooldowns.last_issued_at <= ?");
    // And it acts on the number of rows the CAS actually changed.
    expect(gate).toMatch(/const claimed = await d1RunChanges/);
    expect(gate).toContain("if (claimed !== 1)");
  });

  it("is seven days, measured from the last code the customer was issued", () => {
    expect(reward).toContain("REWARD_COOLDOWN_DAYS = 7");
    expect(gate).toContain("REWARD_COOLDOWN_DAYS * 24 * 60 * 60 * 1000");
  });

  it("gives the week back when the mint fails", () => {
    /*
      The claim is taken before the coupon exists. Without the rollback a
      customer whose mint failed is locked out for a week having received
      nothing.
    */
    expect(gate).toContain("rollbackCooldownClaim");
    const rollback = bodyOf(reward, "async function rollbackCooldownClaim");
    // Guarded on the claim's own order and timestamp, so a concurrent winner
    // is never undone by a loser's failure.
    expect(rollback).toContain("AND last_order_id = ? AND last_issued_at = ?");
    // Two statements: the first-ever claim has no previous timestamp to restore.
    expect(rollback).toContain("DELETE FROM review_reward_cooldowns");
    expect(rollback).toContain("SET last_issued_at = prev_issued_at");
  });

  it("reads a field rather than the row, because d1First answers with {}", () => {
    expect(gate).toContain("held?.last_issued_at");
    expect(gate).toMatch(/if \(!lastIssuedAt\) return \{ ok: false, reason: "failed" \}/);
  });

  it("does not spend the week again on an order that already has a code", () => {
    expect(gate).toContain("alreadyIssued: true");
  });
});

describe("nothing mints without an admin", () => {
  it("the plain star endpoint hands out no code", () => {
    expect(reviewsRoute).not.toContain("issueReviewReward");
    expect(reviewsRoute).not.toContain("issueApprovedReviewReward");
  });

  it("the submission endpoint hands out no code", () => {
    expect(orderReviewRoute).not.toContain("issueReviewReward");
    expect(orderReviewRoute).not.toContain("issueApprovedReviewReward");
  });

  it("completion sends an invitation and mints nothing", () => {
    const invitation = bodyOf(reward, "export async function sendReviewInvitation");
    expect(invitation).not.toContain("issueReviewReward");
    expect(invitation).not.toContain("mintCode");
  });

  it("only the approval issues one", () => {
    expect(bodyOf(reviews, "export async function approveReviewGroup")).toContain(
      "issueApprovedReviewReward",
    );
    expect(bodyOf(reviews, "export async function rejectReviewGroup")).not.toContain(
      "issueApprovedReviewReward",
    );
  });

  it("the dead pre-approval minting is gone for good", () => {
    const dead = read("src/lib/reviews-coupons.functions.ts");
    expect(dead).not.toContain("export const approveReview");
    expect(dead).not.toContain("export const submitProductReview");
    /*
      With the comments stripped. The note left in that file names the table it
      deleted, and a plain text search would read that epitaph as the code.
    */
    const code = dead.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("review_cooldowns");
  });
});

describe("the auto-publish cron cannot touch a submission", () => {
  it("skips anything with a group id, on top of the distinct status", () => {
    /*
      `reconcilePendingVerifiedReviews` runs every minute and publishes pending
      rows as approved. A submission that it picked up would be published
      without the admin ever seeing it — which is the whole requirement.
      Two independent guards, so one being edited away is not enough.
    */
    const cron = bodyOf(reviews, "export async function reconcilePendingVerifiedReviews");
    expect(cron).toContain("status = 'pending'");
    expect(cron).toContain("review_group_id IS NULL");
  });

  it("a submission lands in its own status, not in 'pending'", () => {
    expect(bodyOf(reviews, "export async function submitOrderReviewGroup")).toContain(
      'status: "awaiting_admin"',
    );
  });
});

describe("one review covers the whole order", () => {
  const submit = bodyOf(reviews, "export async function submitOrderReviewGroup");

  it("writes a row per product under one group id", () => {
    expect(submit).toContain("for (const productId of productIds)");
    expect(submit).toContain("reviewGroupId: groupId");
    // The same words on every product — the owner's rule.
    expect(submit).toContain("comment: comment.slice(0, REVIEW_COMMENT_MAX)");
  });

  it("refuses a second live submission for the same order", () => {
    expect(submit).toContain("status IN ('awaiting_admin', 'approved')");
    expect(submit).toContain('reason: "already_submitted"');
  });

  it("checks the proof server-side, not only in the sheet", () => {
    expect(submit).toContain("isOwnReviewMediaUrl(deliveryMediaUrl, input.userId)");
    // The Instagram proof is a still image: a video would be unreadable at
    // card size and is not what was asked for.
    expect(submit).toContain("isOwnReviewImageUrl(instagramProofUrl, input.userId)");
  });
});

describe("the surfaces", () => {
  it("the sheet has two steps and issues nothing", () => {
    expect(sheet).toContain("خطوة ${step} من 2");
    expect(sheet).toContain("إرسال للموافقة");
    expect(sheet).not.toMatch(/REV-|couponCode/);
  });

  it("the sheet refuses to invent an Instagram link", () => {
    expect(sheet).toContain("data.instagramPostUrl ?");
    expect(sheet).toContain("لم تُحدَّد بعد رابط المنشور المثبّت");
  });

  it("the admin decides by hand, and is told when the week was already spent", () => {
    expect(panel).toContain('action: "approve"');
    expect(panel).toContain('action: "reject"');
    expect(panel).toContain("result.cooldown?.nextEligibleAt");
    // Both attachments are on the card: approving without seeing the proof is
    // the same as not asking for it.
    expect(panel).toContain("group.screenshotUrl");
    expect(panel).toContain("group.instagramProofUrl");
  });

  it("the inbox filter exists beside the closed tickets, with a server count", () => {
    expect(customerList).toContain("التقييمات بحاجة إلى موافقة");
    expect(customerList).toContain('id: "pending_reviews"');
    // Counted server-side: a submission has no conversation to be counted in.
    expect(customerList).toContain("pendingReviewCount");
    expect(inboxView).toContain('activeFilter === "pending_reviews"');
    expect(inboxView).toContain("ReviewApprovalPanel");
  });

  it("the rejection reason reaches the customer", () => {
    expect(adminRoute).toContain('String(input["reason"] ?? "")');
    expect(orderReviewRoute).toContain("rejection_reason");
    expect(sheet).toContain("لم تُقبل محاولتك السابقة");
  });
});
