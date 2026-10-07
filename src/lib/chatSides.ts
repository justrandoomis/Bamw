/**
 * Which side of the thread a message sits on.
 *
 * The owner's instruction is physical and not negotiable: **the sender on the
 * right, the shop on the left** — «المرسل يجب أن يكون في اليمين والدعم في
 * اليسار». That is the arrangement their members already know from every
 * messaging app they use, and it does not flip with the language of the
 * interface.
 *
 * So everything here is a PHYSICAL class, on purpose.
 *
 * An earlier pass replaced `ml-auto` with `ms-auto` on exactly this reasoning
 * reversed — margin-inline-start being "the end of the line the reader
 * finishes on". In an Arabic, right-to-left thread that puts the member's own
 * messages on the LEFT, and that is the screen the owner is looking at when
 * they say the messages are the wrong way round. `margin-left: auto` absorbs
 * the free space to the LEFT of the bubble and pins it to the right edge in
 * either direction; `margin-right: auto` is the mirror. Nothing here uses
 * `ms-`/`me-`, `justify-start`/`justify-end`, `items-start`/`items-end` or
 * `rounded-ss`/`rounded-se`, because every one of those follows `dir` and so
 * silently swaps sides in Arabic.
 *
 * One module because the thread had three answers to this question at once —
 * the bubbles, the typing indicator and the loading skeletons each aligned
 * themselves, and two of them disagreed. A bubble that does not line up with
 * the indicator below it is the «أحيانًا بعيدة عن الحافة» the owner also
 * reported: not a stray margin, but two rules fighting.
 */

/**
 * Pins an element to its physical edge inside a flex row or a block.
 *
 * Works on a flex child and on a plain block, since `margin: auto` on the
 * inline axis resolves against the containing block either way.
 */
export function bubbleSide(mine: boolean): string {
  return mine ? "ml-auto mr-0" : "mr-auto ml-0";
}

/**
 * The row one message sits in: the full width of the thread, with its one
 * child pinned to the speaker's edge.
 *
 * «فقاعه الرسالة تظهر زاحفة الى المنتصف الرسالة من النظام او الادمن». The
 * row used to be `w-fit`, pinned by `bubbleSide`, around a bubble capped at
 * `max-w-[80%]`. A percentage inside a box that is as wide as its content is
 * circular, so the browser sized the row to the text, then capped the bubble
 * at 80% of that, and laid the bubble at the row's inline START — the right,
 * in Arabic. On the left side of the thread that left a fifth of the row
 * empty between the shop's bubble and its edge: 42px on a 375px phone, more
 * for a longer message. In English the same gap opened on the member's side.
 *
 * Full width, the 80% is 80% of the thread, and each side's margin pins the
 * child where `bubbleSide` would — physically, the same in either language.
 */
export function bubbleRow(mine: boolean): string {
  return mine ? "flex w-full [&>*]:ml-auto [&>*]:mr-0" : "flex w-full [&>*]:mr-auto [&>*]:ml-0";
}

/**
 * The squared-off corner that points at the speaker.
 *
 * Physical too, and for the same reason: the tail belongs on the side the
 * bubble is pinned to, and `rounded-ss`/`rounded-se` swap sides with the
 * language while the bubble no longer does.
 */
export function bubbleTail(mine: boolean): string {
  return mine ? "rounded-tr-[4px]" : "rounded-tl-[4px]";
}
