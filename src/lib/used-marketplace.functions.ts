/**
 * Server functions for the used & returned marketplace.
 *
 * Every seller-facing call carries the caller's own id from the session, never
 * from the payload — a listing id in the body is a claim, not a permission, and
 * ownership is checked in the server module against the session user.
 */

import { createServerFn } from "@tanstack/react-start";
import { buildContactLinks } from "./contact-links";
import { z } from "zod";

import { requireAdmin, requireAppAuth, authed } from "./auth.middleware";
import { findUserById } from "./db.server";
import {
  REPORT_REASONS,
  SOLD_ANSWERS,
  UsedMarketError,
  answerSoldPrompt,
  createDraft,
  expireDueListings,
  listOpenReports,
  recordContactClick,
  reportListing,
  resolveReport,
  getListing,
  getUsedConfig,
  listListingEvents,
  listPublicListings,
  listReviewQueue,
  listSellerListings,
  saveUsedConfig,
  transitionListing,
  updateDraft,
  type UsedListing,
} from "./used-marketplace.server";
import {
  CONDITION_GRADE_VALUES,
  GUARANTEE_VALUES,
  PACKAGING_VALUES,
  USED_LISTING_STATUSES,
  USED_TYPE_VALUES,
  allowedTransitions,
  type ValidationIssue,
} from "./used-marketplace";

const statusEnum = z.enum(USED_LISTING_STATUSES);

const draftFields = z.object({
  canonicalProductId: z.string().max(64).nullish(),
  title: z.string().max(200).optional(),
  titleEn: z.string().max(200).nullish(),
  usedType: z.enum(USED_TYPE_VALUES).nullish(),
  platform: z.string().max(80).nullish(),
  conditionGrade: z.enum(CONDITION_GRADE_VALUES).nullish(),
  packaging: z.enum(PACKAGING_VALUES).nullish(),
  guarantee: z.enum(GUARANTEE_VALUES).nullish(),
  description: z.string().max(4000).nullish(),
  conditionNotes: z.string().max(2000).nullish(),
  defects: z.array(z.string().max(200)).max(20).optional(),
  priceIqd: z.number().finite().nonnegative().optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  photos: z.array(z.string().max(400)).max(20).optional(),
  usagePeriodMonths: z.number().finite().min(0).max(600).nullish(),
  warrantyMonths: z.number().finite().min(0).max(120).nullish(),
  /*
    Kept as a loose map at this boundary on purpose.

    The keys are narrowed and the values validated by `normalizeContact` in the
    storage layer, which is the one place that knows what a usable handle looks
    like per channel. Narrowing here as well would mean two places to change
    when a channel is added, and the stricter of the two is the one that builds
    the link.
  */
  contact: z.record(z.string().max(200)).optional(),
});

/**
 * Turns the module's error codes into a shape the UI can act on.
 *
 * Field-level issues are handed back untouched so the submission form can put
 * each message under the input it belongs to rather than showing one banner.
 */
function fail(error: unknown): { success: false; error: string; issues?: ValidationIssue[] } {
  if (error instanceof UsedMarketError) {
    return {
      success: false,
      error: error.message,
      ...(error.issues.length ? { issues: error.issues } : {}),
    };
  }
  console.error("[used-marketplace] request failed", error);
  return { success: false, error: "UNEXPECTED_ERROR" };
}

/**
 * Strips the fields only the seller and the store may see.
 *
 * The contact is the exception, and only once the listing is live. The whole
 * point of the section is that a buyer reaches the seller directly, so a
 * published listing carries its contact buttons — but as *links built here*
 * from validated handles, never as the raw text the seller typed, and never
 * before an admin has approved the listing. A draft, a rejected listing or one
 * waiting in review carries nothing: those are visible only to their own
 * seller, who does not need to be told their own number.
 *
 * The review and money fields stay hidden in every case.
 */
function publicView(listing: UsedListing) {
  const {
    contact,
    reviewNotes: _reviewNotes,
    reviewedByUserId: _reviewedBy,
    feeAmount: _feeAmount,
    feePaidAt: _feePaidAt,
    feeCycle: _feeCycle,
    feePaidCycle: _feePaidCycle,
    ...rest
  } = listing;
  return {
    ...rest,
    contactLinks: listing.status === "APPROVED" ? buildContactLinks(contact) : [],
  };
}

/* ------------------------------- storefront ------------------------------- */

export const loadUsedMarketplace = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        canonicalProductId: z.string().max(64).optional(),
        limit: z.number().int().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const config = await getUsedConfig();
    if (!config.enabled) return { enabled: false, listings: [], config: null };
    const listings = await listPublicListings({
      canonicalProductId: data?.canonicalProductId,
      limit: data?.limit,
    });
    return {
      enabled: true,
      listings: listings.map(publicView),
      config: {
        policyVersion: config.policyVersion,
        listingFeeIqd: config.listingFeeIqd,
        listingDurationDays: config.listingDurationDays,
      },
    };
  });

export const loadUsedListing = createServerFn({ method: "GET" })
  .validator(z.object({ listingId: z.string().max(64) }))
  .handler(async ({ data }) => {
    const listing = await getListing(data.listingId);
    if (!listing || listing.status !== "APPROVED") return { listing: null };
    // An expired window is not public even if the sweeper has not run yet.
    if (listing.expiresAt && listing.expiresAt <= new Date().toISOString())
      return { listing: null };
    const seller = await findUserById(listing.sellerUserId);
    return {
      listing: publicView(listing),
      seller: seller ? { id: seller.id, name: seller.name } : null,
    };
  });

/* --------------------------------- seller -------------------------------- */

export const loadMyUsedListings = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    const config = await getUsedConfig();
    const listings = await listSellerListings(authed(context).userId);
    const user = await findUserById(authed(context).userId);
    return {
      enabled: config.enabled,
      listings,
      walletBalance: Number(user?.walletBalance ?? 0),
      config: {
        listingFeeIqd: config.listingFeeIqd,
        listingDurationDays: config.listingDurationDays,
        maxActiveListingsPerSeller: config.maxActiveListingsPerSeller,
        maxPhotos: config.maxPhotos,
        minPriceIqd: config.minPriceIqd,
        maxPriceIqd: config.maxPriceIqd,
        policyVersion: config.policyVersion,
      },
    };
  });

export const createUsedListing = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(draftFields)
  .handler(async ({ data, context }) => {
    try {
      const listing = await createDraft(authed(context).userId, data as never);
      return { success: true as const, listing };
    } catch (error) {
      return fail(error);
    }
  });

export const updateUsedListing = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(draftFields.extend({ listingId: z.string().max(64) }))
  .handler(async ({ data, context }) => {
    try {
      const { listingId, ...fields } = data;
      const listing = await updateDraft(authed(context).userId, listingId, fields as never);
      return { success: true as const, listing };
    } catch (error) {
      return fail(error);
    }
  });

export const submitUsedListing = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      listingId: z.string().max(64),
      policyAccepted: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    try {
      const listing = await transitionListing(data.listingId, "SUBMITTED", {
        actor: "seller",
        actorUserId: authed(context).userId,
        policyAccepted: data.policyAccepted === true,
      });
      return { success: true as const, listing };
    } catch (error) {
      return fail(error);
    }
  });

/** Withdraw, pause, resume, or relist — all the moves a seller owns. */
export const moveUsedListing = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      listingId: z.string().max(64),
      to: z.enum(["DRAFT", "PAUSED", "APPROVED"]),
    }),
  )
  .handler(async ({ data, context }) => {
    try {
      const listing = await transitionListing(data.listingId, data.to, {
        actor: "seller",
        actorUserId: authed(context).userId,
      });
      return { success: true as const, listing };
    } catch (error) {
      return fail(error);
    }
  });

/* --------------------------------- admin --------------------------------- */

export const loadUsedReviewQueue = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator(z.object({ status: statusEnum.optional() }).optional())
  .handler(async ({ data }) => {
    const [config, listings] = await Promise.all([getUsedConfig(), listReviewQueue(data?.status)]);
    const sellerIds = [...new Set(listings.map((l) => l.sellerUserId))];
    const sellers = await Promise.all(sellerIds.map((id) => findUserById(id)));
    const sellerById = new Map(
      sellers.filter(Boolean).map((u) => [u!.id, { id: u!.id, name: u!.name, phone: u!.phone }]),
    );
    return {
      config,
      listings: listings.map((listing) => ({
        ...listing,
        seller: sellerById.get(listing.sellerUserId) ?? null,
        nextStatuses: allowedTransitions(listing.status, "admin"),
      })),
    };
  });

export const loadUsedListingHistory = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator(z.object({ listingId: z.string().max(64) }))
  .handler(async ({ data }) => ({
    listing: (await getListing(data.listingId)) ?? null,
    events: await listListingEvents(data.listingId),
  }));

export const reviewUsedListing = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      listingId: z.string().max(64),
      to: statusEnum,
      note: z.string().max(1000).optional(),
      soldOrderId: z.string().max(64).optional(),
      isReturned: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    try {
      const listing = await transitionListing(data.listingId, data.to, {
        actor: "admin",
        actorUserId: authed(context).userId,
        note: data.note,
        soldOrderId: data.soldOrderId,
        isReturned: data.isReturned,
      });
      return { success: true as const, listing };
    } catch (error) {
      return fail(error);
    }
  });

export const saveUsedMarketplaceConfig = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      enabled: z.boolean().optional(),
      listingFeeIqd: z.number().finite().nonnegative().optional(),
      listingDurationDays: z.number().int().min(1).max(365).optional(),
      maxActiveListingsPerSeller: z.number().int().min(1).max(500).optional(),
      maxPhotos: z.number().int().min(1).max(20).optional(),
      minPriceIqd: z.number().finite().min(1).optional(),
      maxPriceIqd: z.number().finite().min(1).optional(),
      policyVersion: z.string().max(40).optional(),
      refundFeeOnReject: z.boolean().optional(),
      requireReview: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const config = await saveUsedConfig(data);
    await import("./db.server").then(({ createAuditLog }) =>
      createAuditLog(
        authed(context).userId,
        "used_marketplace.config",
        "settings",
        "usedMarketplace",
        null,
        config,
      ),
    );
    return { success: true as const, config };
  });

export const sweepExpiredUsedListings = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => expireDueListings());

/* --------------------- contact, the sale, and reports --------------------- */

/**
 * A viewer pressed one of the seller's contact buttons.
 *
 * Deliberately open to a signed-out visitor: the buttons are on a public page,
 * and requiring an account to press one would put a login wall between a buyer
 * and a seller for no gain. Nothing about who pressed it is recorded — the
 * point is the seller's prompt three days later, and keeping a note of which
 * member looked at whose listing would collect something nobody needs.
 *
 * It returns nothing to say. The press has already opened the seller's link in
 * the browser; this is bookkeeping running beside it, and a failure here must
 * not look to the buyer like the button did not work.
 */
export const noteUsedContactClick = createServerFn({ method: "POST" })
  .validator(z.object({ listingId: z.string().max(64) }))
  .handler(async ({ data }) => {
    try {
      await recordContactClick(data.listingId);
    } catch (error) {
      console.error("[used-marketplace] recording a contact click failed", error);
    }
    return { success: true as const };
  });

/** The seller's answer to "did you sell it?". */
export const answerUsedSoldPrompt = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(z.object({ listingId: z.string().max(64), answer: z.enum(SOLD_ANSWERS) }))
  .handler(async ({ data, context }) => {
    try {
      const listing = await answerSoldPrompt(authed(context).userId, data.listingId, data.answer);
      return { success: true as const, listing: publicView(listing) };
    } catch (error) {
      return fail(error);
    }
  });

/**
 * Somebody reports a listing.
 *
 * Signed in, unlike the contact click: a report asks an admin to spend
 * attention on somebody else's listing, and one report per member per listing
 * is the limit that makes that bearable. It changes nothing on its own.
 */
export const reportUsedListing = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      listingId: z.string().max(64),
      reason: z.enum(REPORT_REASONS),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    try {
      const result = await reportListing(
        authed(context).userId,
        data.listingId,
        data.reason,
        data.note,
      );
      return { success: true as const, recorded: result.recorded };
    } catch (error) {
      return fail(error);
    }
  });

/** The reports an admin has not dealt with yet. */
export const loadUsedReports = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => ({ reports: await listOpenReports() }));

/** An admin has dealt with a report, whatever they decided. */
export const resolveUsedReport = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({ reportId: z.string().max(64) }))
  .handler(async ({ data, context }) => {
    await resolveReport(authed(context).userId, data.reportId);
    return { success: true as const };
  });
