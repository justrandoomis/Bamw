/**
 * The game name in the order-prep tool, which copies the supplier's name for it.
 *
 * One component for both places it appears — the short card in the strip and
 * the opened delivery-item card — because the rules below only hold if they
 * hold in both, and two copies of them would drift.
 *
 * What an admin sees is a game name. What the clipboard gets is the Chinese
 * name the order is placed with at the supplier. There is no button, no icon,
 * no "copy" label, no tooltip, no toast, no change of colour or cursor, and
 * the Chinese name is never rendered.
 *
 * Two rules cost money if they break:
 *
 *   - **The English title is never copied as a fallback.** An order placed
 *     against an English title is an order placed for the wrong game. When
 *     there is no Chinese name the clipboard is left alone and the gap is
 *     logged for an admin — never shown as an error, because an error the
 *     admin cannot act on mid-delivery is just noise.
 *   - **The click does not reach the card.** The card is itself the selector,
 *     so without `stopPropagation` an admin trying to copy would change what
 *     they are looking at.
 *
 * It renders a plain `<span>` rather than anything with a button role. The
 * short card *is* a `<button>`, and a button may not contain another
 * interactive element — browsers disagree about what to do when it does. The
 * cost is that there is no keyboard path to the copy; the card itself stays
 * fully keyboard-operable, and an invisible affordance that no keyboard user
 * can discover was never the accessible option anyway.
 */

import type { ReactNode } from "react";

/**
 * Put text on the clipboard without saying anything about it.
 *
 * `navigator.clipboard` needs a secure context and is refused outright by some
 * mobile browsers inside a modal, which is exactly where this runs. The
 * textarea fallback is positioned off-screen rather than hidden: an element
 * with `display: none` cannot be selected, which is why the obvious version of
 * this trick silently does nothing on Safari.
 */
export async function copySilently(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Denied or unavailable — fall through rather than give up. */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export interface SupplierNameCopyProps {
  /** The Chinese name to copy. Empty means "not filled in yet". */
  supplierName: string;
  /** Called instead of copying when there is no Chinese name. */
  onMissing?: () => void;
  className?: string;
  /** The English title, which is what is shown. */
  children: ReactNode;
}

export function SupplierNameCopy({
  supplierName,
  onMissing,
  className,
  children,
}: SupplierNameCopyProps) {
  return (
    <span
      data-supplier-copy=""
      className={className}
      onClick={(event) => {
        /* The name copies; it does not select the card. */
        event.stopPropagation();
        const name = supplierName.trim();
        if (!name) {
          onMissing?.();
          return;
        }
        void copySilently(name);
      }}
    >
      {children}
    </span>
  );
}
