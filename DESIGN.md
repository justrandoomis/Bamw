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

The same goes for faint white tints (`bg-white/[0.05]`, `border-white/10`,
`hover:text-white`): they were drawn for a dark page and vanish — or hide the
text — on a light one. Use `bg-muted/50`, `border-border/70`,
`hover:text-foreground`.

## Patterns

- **Purchase card** — everything a purchase needs in one piece of clay
  (`rounded-[28px] border-[var(--clay-rim)] bg-card shadow-lg`): the price
  first, then the choices as rows pressed into the card (the chosen one raised
  with a brand-red edge), the quantity as a pressed track holding two small
  clay buttons, and one full-width brand-red button. Secondary actions are
  outlined clay buttons under it.
- **Segmented control** — a pressed track (`rounded-full bg-muted/70 p-1`)
  with the chosen segment raised (`bg-card shadow-sm`). The catalogue's device
  filter, the game page's section rail and the product pages' section rail
  are all this one control.
- **Facts strip** — the facts a buyer checks, as small pressed tiles
  (`rounded-[18px] bg-muted/50`): a label over a value. It scrolls sideways on
  a phone and becomes a grid on a desktop.
- **Artwork** — the art a member tapped on a card is the art the next page
  leads with, in a frame of clay (`p-1.5`, inner radius 6px smaller, a hairline
  inside so bright art keeps its edge). Wide key art only ever appears blurred,
  as a wash masked to transparent so the lit canvas shows through.

## Empty means hidden

A detail page shows what the record has and nothing else: no heading over an
empty row, no «not available», no panel saying there is nothing to show, and
no navigation chip pointing at a section that was dropped. The home page does
the same with its shelves — a shelf with no products is not drawn.

## The game page, in order

The hero carries the purchase: the card art, the name, what it runs on, and
the purchase card listing every way to buy the game with its price. Below it,
the sections follow the questions a buyer asks next — what the game is, how it
runs on their Switch, editions and add-ons, what we and the players think,
what to know before paying, its history, and what to play next.
