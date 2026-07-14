# Tab Harbor design contract

Tab Harbor is a quiet browser workspace for returning to active work. It is not
a SaaS dashboard, wallpaper page, launcher, or productivity game.

## Product character

- Calm: reduce browser noise without hiding useful state.
- Literary: use editorial typography and reading-surface cues with restraint.
- Composed: make dense content easy to scan through alignment and rhythm.
- Local: interactions should feel immediate, private, and lightweight.

When choices conflict, prefer legibility over decoration, structure over copy,
and useful workspace behavior over feature theatre.

## System model

The visual environment has three independent layers:

1. **Tone** — `system`, `light`, or `dark`.
2. **Style** — typography, density, geometry, material, and color family.
3. **Personalization** — background image, surface depth, shortcut geometry,
   drawer speed, and optional content settings.

Changing style must not reset personalization or alter the information model.

## Curated styles

| ID | Intent |
| --- | --- |
| `paper-desk` | Warm parchment and the primary Tab Harbor identity. |
| `ivory-index` | Compact, precise, content-first personal index. |
| `harbor-mist` | Airy, cool, low-pressure focus surface. |
| `clay-notes` | Warm, personal, tactile notes without playful UI chrome. |
| `botanical-folio` | Specimen paper, sage ink, and quiet herbarium taxonomy. |
| `porcelain-atlas` | Glazed ivory, cobalt contours, and cartographic order. |
| `nocturne-observatory` | Celestial ink, brass measures, and restrained depth. |
| `vermilion-seal` | Rice paper, dark ink, and sparingly used cinnabar marks. |

New styles must remain recognizable as Tab Harbor. Do not add a style merely
because it is visually fashionable.

## Token hierarchy

Runtime definitions live in `extension/theme-catalog.js`.

1. Palette compatibility tokens: `--ink`, `--paper`, `--card-bg`, status and
   workspace accent variables.
2. Semantic color tokens: `--th-color-*`, focus, tooltip, drawer, and chip
   variables in `extension/style.css`.
3. Style tokens: `--th-font-*`, `--th-container-*`, density, radius, material,
   elevation, and divider variables supplied by the selected style.
4. Component rules: existing dashboard selectors consume semantic tokens and
   must not branch into duplicated per-style component implementations.

Prefer token changes over selector overrides. Use a style-specific selector
only when a style has a genuine structural expression, such as Botanical
Folio's specimen labels, Porcelain Atlas's mapped contours, Nocturne
Observatory's circular instruments, or Vermilion Seal's compact stamp geometry.

## Visual scales and semantic roles

Shared primitives are defined in `extension/style.css`; components consume
semantic aliases rather than choosing nearby literals independently.

- Spacing follows the shared `2/4/6/8/10/12/16/20/24/32/40/48` rhythm.
- Radius follows `3/6/10/16/22/pill`, then maps to panel, card, control, and
  field roles.
- Control geometry separates visible height from the minimum hit target.
- Borders use hairline, strong, and focus-width roles.
- Typography uses control, label, eyebrow, metadata, body, panel-title, and
  display roles for size, weight, tracking, and line height.
- Icons use the shared compact-to-shortcut scale; fetched favicon resolution is
  a data concern and is not an icon-layout token.
- Elevation uses control, item, floating-panel, drag-preview, and toast roles.
- Motion uses fast, standard, slow, and entrance durations plus documented
  drawer and reorder interaction timings.

Theme definitions may remap semantic density, typography, material, elevation,
and geometry. They must not create a second set of generic button dimensions,
icon sizes, border widths, or motion timings.

Component CSS must not introduce a new fixed visual value when an existing
primitive or semantic role expresses the intent. Legitimate local exceptions
include breakpoints, structural panel widths, switch internals, drag offsets,
user-configurable shortcut masks, compact popup geometry, and theme-specific
material treatments. Name recurring exceptions with a narrow
component token instead of repeating their literal value.

## Component rules

- Use spacing and alignment before adding containers.
- Reserve raised surfaces for drawers, editors, pickers, and floating menus.
- Keep tab, saved, and todo content denser than utility controls.
- Keep secondary controls visually quieter than open-tab content.
- Use one restrained workspace accent; status colors communicate status only.
- Avoid nested cards, thick outlines, generic white-card shadows, and pill
  shapes on every element.
- Theme previews are material samples, not decorative illustrations.

### Shortcut icon surfaces

Shortcut icons share an optical slot, not a forced visible silhouette. Keep
artwork fitting independent from the plate beneath it:

- **Glyph** — transparent mark on a quiet circular plate; use `contain`.
- **Brand tile** — opaque square or rounded-square artwork with no second
  plate; preserve its own corners and use `cover`.
- **Disc** — intrinsically circular artwork with no second plate; use
  `contain` and preserve its native circle.
- **Original artwork** — irregular or uncertain artwork on a quiet
  rounded-square plate; use `contain` to avoid destructive cropping.

Do not force brand tiles into circles or add a second circle behind intrinsic
disc icons. Automatic analysis may change as classifiers improve, but the
`Artwork + Plate + Fit` separation is the stable component contract.

## Typography

- New themes and component redesigns must use serif typography; do not
  introduce new sans-serif font roles.
- Ivory Index uses a system serif stack across display, reading, labels, and
  controls so its typography remains consistent without external font assets.
- Shared UI, display, section, label, and control roles resolve to serif
  families; style identity comes from proportion, weight, tracking, and rhythm.
- Styles change the role and proportion of fonts, not the font-loading stack.
- Use tabular figures for counts, dates, and compact data where alignment helps.
- Keep headings intentional but never marketing-sized.

## Motion and accessibility

- Keyboard focus is always visible.
- Critical controls are not hover-only.
- Compact controls retain comfortable hit targets.
- Motion clarifies local state changes and uses transform/opacity where possible.
- `prefers-reduced-motion` must preserve every state without animation.
- Selection must be communicated by more than color alone.
- Every style must maintain readable contrast in both light and dark tones.

## Runtime contract

The extension uses ordered classic scripts with no build step.

- `theme-catalog.js` must load before `theme-controls.js` on the dashboard and
  popup surfaces.
- Catalog bindings are exposed through `globalThis.TabHarborThemeCatalog`.
- File-local imports use prefixed aliases to avoid top-level collisions.
- `styleId` is canonical; `paletteId` remains a migration compatibility alias.
- The root body exposes `data-theme-style`, `data-theme-palette`, and tone
  classes for CSS and separate popup synchronization.

## Validation checklist

For theme or visual-system changes:

1. Run `node --test extension/*.test.js`.
2. Load the real extension and inspect browser startup errors.
3. Check all styles in light and dark tones.
4. Check custom backgrounds, drawer states, editors, and empty states.
5. Check keyboard focus, narrow layouts, and reduced motion.

Long-form rationale and lessons remain in `.impeccable.md` and
`docs/design-principles-and-lessons.md`.
