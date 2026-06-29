# Tab Harbor UI System

Tab Harbor uses Astryx as design-system inspiration, not as a runtime UI library. The extension remains a static, dependency-light Manifest V3 workspace made from HTML, CSS, and ordered scripts.

## Positioning

Tab Harbor should feel like a quiet browser workbench: calm, literary, composed, and useful before it is decorative. Astryx is useful here for its system thinking: tokens, reusable primitives, accessible states, theme discipline, and agent-readable component boundaries.

Do not import Astryx, React, StyleX, a bundler, or generated build output for this path.

## Principles

- Preserve the reading-desk atmosphere.
- Prefer scanability over spectacle.
- Keep secondary controls quiet.
- Treat accent color as scarce.
- Keep keyboard focus visible.
- Do not rely on hover alone for critical controls.
- Make reduced-motion states understandable without animation.
- Keep component boundaries usable in plain HTML and CSS.

## Token layers

`extension/style.css` keeps the existing project tokens as the visual source of truth, including `--ink`, `--paper`, `--card-bg`, `--workspace-accent`, and related theme variables.

The `--th-*` layer is a semantic alias layer for future component work:

| Layer | Purpose |
| --- | --- |
| `--th-font-*` | UI and editorial typography aliases |
| `--th-color-*` | Text, surface, border, accent, status, and overlay aliases |
| `--th-space-*` | Shared spacing steps for compact controls and panels |
| `--th-radius-*` | Radius scale from small controls to soft panels |
| `--th-control-*` | Shared control heights and hit-target sizing |
| `--th-shadow-*` | Quiet elevation for cards, floating controls, and panels |
| `--th-focus-*` | Keyboard focus ring and focus shadow |
| `--th-motion-*` | Short, quiet transition timing |

Prefer adding new component CSS against `--th-*` aliases. Keep existing project tokens available for legacy selectors and theme internals.

## Component primitives

The local component foundation is CSS-only:

- `.th-surface`: paper-like bounded surface.
- `.th-card`: card surface for grouped content.
- `.th-control`: shared button/control base.
- `.th-control-primary`: primary action treatment.
- `.th-icon-control`: compact icon control with a comfortable hit target.
- `.th-field-shell`: input wrapper with focus-within styling.
- `.th-chip`: compact badge or status chip.
- `.th-tab`: quiet tab-like control.
- `.th-focus-ring`: opt-in focus style for custom controls.

These classes are intentionally additive. Existing selectors do not need to be rewritten until a product change touches that component.

## Adoption rules

When adding or refactoring UI:

1. Start with existing Tab Harbor tokens and the `--th-*` semantic layer.
2. Use `.th-*` primitives for new surfaces and controls when practical.
3. Keep helper affordances quieter than tab content.
4. Avoid one-off colors, radii, shadows, and transition timings unless the local system cannot express the need.
5. Prefer focus-visible states that match `--th-focus-ring` and `--th-focus-shadow`.
6. If animation is added, ensure the reduced-motion media query still communicates state.

## Non-goals

- No React migration.
- No StyleX runtime or build integration.
- No root `package.json` or package-manager workflow.
- No generated component output.
- No global visual redesign.

If a future task needs real Astryx components, isolate that work in a separate experiment or React island rather than changing the main dashboard architecture.
