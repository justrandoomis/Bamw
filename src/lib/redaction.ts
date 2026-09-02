/**
 * Remove internal assistant reasoning/memory before returning a chat message.
 *
 * Fails closed on a body that is not an object. A corrupt stored document used
 * to arrive here with `body === undefined`, and `"support" in undefined` throws
 * — which turned one unreadable row into a 500 for the member's whole
 * conversation while staff, who skip redaction, saw nothing wrong. Returning an
 * empty body is both crash-proof and the safe direction: an unrecognisable
 * shape cannot be proven free of internal fields, so none of it is forwarded.
 */
export function redactMessageForMember<T extends { body: Record<string, unknown> }>(message: T): T {
  const body = message?.body;
  if (!body || typeof body !== "object") {
    return { ...message, body: {} as Record<string, unknown> };
  }
  if (!("support" in body)) return message;
  const { support: _support, ...rest } = body;
  return { ...message, body: rest };
}

/** Remove staff identity and private notes from an order status audit row. */
export function redactOrderHistoryForMember<T extends Record<string, unknown>>(row: T) {
  const { changed_by: _actor, note: _note, ...publicRow } = row;
  return publicRow;
}

/** Remove fields intended only for staff from the member's trade response. */
export function redactDiscTradeForMember<T extends Record<string, unknown>>(row: T) {
  const {
    admin_notes: _adminNotes,
    thread_id: _threadId,
    status_history: rawHistory,
    ...publicRow
  } = row;

  let statusHistory: unknown = rawHistory;
  if (typeof rawHistory === "string") {
    try {
      const parsed = JSON.parse(rawHistory);
      statusHistory = Array.isArray(parsed)
        ? JSON.stringify(
            parsed.map((entry) => {
              if (!entry || typeof entry !== "object") return entry;
              const record = entry as Record<string, unknown>;
              return { status: record["status"], at: record["at"] };
            }),
          )
        : "[]";
    } catch {
      statusHistory = "[]";
    }
  }

  return { ...publicRow, status_history: statusHistory };
}

/**
 * Remove the staff-only note from a product request before a customer reads it.
 *
 * `admin_note` is where staff record what a supplier is charging and whether a
 * request is worth taking — the admin form labels it "ملاحظات إدارية (داخلية
 * فقط)". The customer's own request history is served by the same endpoint as
 * the admin list, and while every camelCase field was arriving `undefined` the
 * note was accidentally unreachable; translating the row correctly makes it
 * real, so it has to be dropped here on the way out.
 *
 * `userVisibleNote` is deliberately kept: it is the reply written *for* the
 * customer. So are the status-trail notes, which carry that same reply.
 */
export function redactProductRequestForMember<T extends { adminNote?: string }>(request: T) {
  const { adminNote: _adminNote, ...visible } = request;
  return visible;
}
