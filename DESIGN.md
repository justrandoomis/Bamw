# Bananto — design system: clay

The whole shop — storefront, banana section, chat, account pages and the admin —
is built from one material: soft clay. The rules live in `src/styles.css`
(the «Claymorphism» section); this page says what they mean so a new screen
looks like the rest without anyone redrawing it.

## The material

- **Raised clay** — a card, a button, the dock. A soft drop shadow lifts it off
  the page, light is pressed into its top edge and shade into its bottom, and a
  rim of light runs where a border would be.
- **Pressed clay** — a field, a track, a chip, a placeholder: the same clay
  pushed in (an inner shadow).
- **The canvas** — the page colour, lit softly from above (`.clay-canvas`).

| Recipe        | Use                                                  | Token / class                                   |
| ------------- | ---------------------------------------------------- | ----------------------------------------------- |
| Small         | chips, small buttons, a segment of a control         | `--clay-1` · `shadow-sm` · `.clay-1`            |
| Card          | cards, panels                                        | `--clay-2` · `shadow-md` · `.clay-2`            |
| Floating      | sheets, dialogs, the bottom dock, the cart's pay bar | `--clay-3` · `shadow-xl`/`2xl` · `.clay-3`      |
| Filled button | any button or link with a fill                       | `--clay-btn` (automatic)                        |
| Pressed       | a held button, a field, a track                      | `--clay-pressed` / `--clay-well` · `.clay-well` |

Tailwind's shadow scale _is_ the clay scale, so `shadow-sm`, `shadow-md` and
`shadow-2xl` already draw clay; `shadow-none` and `ring-*` still win.

## What is automatic

You rarely need a clay class. Write the screen the way the shop always has:

- `rounded-2xl border border-border bg-card` → a raised card with a rim of
  light (a card inside a card is a smaller piece).
- `rounded-… bg-muted` / `bg-secondary` on something that is not a control →
  a pressed track or chip. `bg-muted` around `bg-card shadow-sm` is a
  segmented control.
- `<button>`/`<a>` with a fill (`bg-banana`, `bg-foreground`, `bg-card`…) →
  a clay button that squashes when pressed. Ghost buttons (fill only on
  hover) stay flat.
- Text fields, text areas and selects → wells.

A coloured border (`border-banana/40`, `border-rose-…`) is kept: it means
something. Only the plain `border-border` becomes the rim.

## Shape

- Radii come from `--radius: 0.875rem`: `rounded-lg` 14px, `xl` 18px, `2xl`
  22px, `3xl` 26px. Cards are `2xl`/`3xl`, buttons `xl`/`2xl` or full pills.
- One radius per element. No hand-drawn, uneven corners.

## Motion (Apple)

- A control answers on the **press**: `scale: 0.97` and the pressed shadow,
  in 80ms. It returns over ~300ms on `--clay-ease`, critically damped — no
  overshoot. Only a gesture that carried momentum may bounce.
- `prefers-reduced-motion` keeps the depth and drops the squash.
- `prefers-contrast: more` gives every card a real border back.
- The «lite motion» setting turns shadows off for slow phones, as before.

## Themes

Every recipe is tuned per pack in `styles.css`: light packs (cream, banana)
shade with their own warm ink; dark packs (midnight, space, cyber) shade with
black and a far fainter light. Never hardcode `bg-white` on a surface — use
`bg-card`, or the dark packs get a white slab.
