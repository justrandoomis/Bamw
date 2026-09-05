import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Turns `?ref=…` on any page into a saved attribution.
 *
 * The link a friend receives is an ordinary product URL with a `ref` parameter,
 * so the capture has to happen wherever they land. Mounted once at the root, it
 * watches the address bar and posts the code to the server, which validates it
 * and answers with the signed cookie.
 *
 * The cookie is the record; nothing about the referral is kept in local storage,
 * which is editable from the browser's console. The only thing stored on this
 * side is a marker that *this exact URL* has already been sent, so a re-render
 * or a back-navigation does not post it again — and that marker grants nothing
 * on its own, because the server re-checks the code every time regardless.
 */

const SENT_KEY = "bananto.referral.captured";

/** Device signals the page can offer. Advisory only — the server re-derives. */
function deviceHints() {
  try {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
      platform: (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
        navigator.platform ?? "",
      language: navigator.language ?? "",
    };
  } catch {
    return undefined;
  }
}

export function ReferralCapture() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);

  /*
    The address bar, as the router sees it — not just as it was on mount.

    This effect used to depend on the query client alone, so it ran once and
    never again. Every `?ref=` link that arrives through a client-side
    navigation was therefore dropped: the shop's own `<Link>`s, the back and
    forward buttons, and — the case that actually loses money — a friend who
    lands on the home page and taps through to the game before the code has
    been read. Watching the router's location means the code is picked up
    wherever it appears, and the session marker below is what stops the same
    URL being posted twice.
  */
  const search = useLocation({ select: (location) => location.searchStr });
  const pathname = useLocation({ select: (location) => location.pathname });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const capture = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("ref");
      if (!code || inFlight.current) return;

      const marker = `${url.pathname}?ref=${code}`;
      try {
        if (window.sessionStorage.getItem(SENT_KEY) === marker) return;
      } catch {
        // Private mode with storage disabled: post anyway, the server dedupes.
      }
      inFlight.current = true;

      /*
        The product is named by the path, not by the query string, so a link
        whose `ref` was pasted onto a different game attributes the game the
        friend is actually looking at.
      */
      const product = url.pathname.startsWith("/product/")
        ? decodeURIComponent(url.pathname.slice("/product/".length))
        : undefined;

      /*
        Whether the code has been *answered*, which is not the same as whether
        it was accepted.

        The address bar is only cleaned once the server has given a verdict —
        applied, refused, or "that is your own link". A request that never got
        an answer, or that was turned away by the rate limiter, leaves `?ref`
        exactly where it is, so a reload or the next navigation tries again.
        Stripping it in a `finally` meant the one case where the code was worth
        keeping — the network dropped, the limiter said "later" — was the case
        where it was thrown away for good, and the friend's discount with it.
      */
      let answered = false;
      try {
        const res = await fetch("/api/referral", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, product, hints: deviceHints() }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; message?: string; selfReferral?: boolean; retryAfter?: number }
          | null;

        if (res.status === 429) {
          /*
            Too many attempts, and until this it was completely silent: no
            message, and the code stripped from the URL on the way out. Say so
            and keep the code.
          */
          toast.error("محاولات كثيرة على كود الإحالة — انتظر قليلاً ثم أعد تحميل الصفحة.", {
            duration: 6000,
          });
          return;
        }

        answered = true;
        try {
          window.sessionStorage.setItem(SENT_KEY, marker);
        } catch {
          // Nothing to remember: the server's own checks still hold.
        }

        if (data?.message) {
          // Your own link is information, not a failure.
          if (data.ok) toast.success(data.message, { duration: 8000 });
          else if (data.selfReferral) toast.info(data.message, { duration: 8000 });
          else toast.error(data.message, { duration: 6000 });
        }
        if (data?.ok) {
          void queryClient.invalidateQueries({ queryKey: ["referral-state"] });
        }
      } catch {
        // Offline or blocked: the link still works, it just did not register.
      } finally {
        inFlight.current = false;
        if (answered) {
          /*
            Take `ref` out of the address bar once it has been handled, so the
            member does not re-share a URL carrying somebody else's code — and
            so a refresh does not look like a second capture.

            The current history state is carried across rather than replaced
            with `{}`. TanStack Router keeps its own bookkeeping there, and
            blanking it made the entry the router was standing on unreadable:
            the next back-navigation, and anything restoring scroll position,
            had nothing to restore from.
          */
          const cleaned = new URL(window.location.href);
          cleaned.searchParams.delete("ref");
          window.history.replaceState(
            window.history.state,
            "",
            `${cleaned.pathname}${cleaned.search}${cleaned.hash}`,
          );
        }
      }
    };

    void capture();
  }, [queryClient, search, pathname]);

  return null;
}

export default ReferralCapture;
