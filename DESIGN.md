# Sivraj Design System Memory

This file captures the design discipline to use for Sivraj UI work. It is inspired by Impeccable's workflow: start with context, improve what exists, check before shipping, and prevent design-system drift.

## Operating Loop

1. Context: identify user, task, state, error paths, and whether the surface is product or brand. Sivraj app screens are product surfaces by default.
2. Shape: decide the interaction model before styling. Pick drawer, popover, inline editor, list, toolbar, or page based on task density.
3. Craft: use existing tokens and primitives first. Reach for `Button`, `Input`, `Select`, `Drawer`, `sonner`, `liquidGlass`, `liquidGlassDense`, and current icon/image assets before inventing new visual language.
4. Polish: tighten type hierarchy, spacing rhythm, active state, focus state, empty state, loading state, and destructive action treatment.
5. Harden: test long model IDs, long names, mobile width, short viewport height, loading, offline/API failure, repeated clicks, reloads, and OAuth callback returns.
6. Maintain: when the same pattern appears three times, extract or reuse a primitive. Do not let near-duplicates drift.

## Visual Direction

- Ambient dark product shell with controlled liquid-glass surfaces.
- Glass is structural: use it for shells, drawers, overlays, controls, and elevated panels. Do not use blur/glow as decoration for its own sake.
- Theme color is an accent, not a flood fill. Use `rgb(var(--theme-color-rgb))` sparingly for active states, focus, key icons, and progress.
- Prefer dark neutral surfaces, near-white text, quiet borders, and precise accent color.
- Provider and brand recognition should use actual logos/images from `apps/web/public/icons` whenever available.

## Layout

- Product screens should prioritize scanability and repeated use.
- Avoid nested cards. Use spacing, dividers, typography, and state indicators instead of card-in-card composition.
- Drawers must keep content internally scrollable and never exceed viewport height.
- Popovers and dropdowns must not be clipped by overflow containers.
- Controls should have stable dimensions so icons, labels, loading state, and hover state do not resize the layout.
- Related items use tight spacing; separate tasks use larger spacing. Avoid monotonous same-gap layouts.

## Typography

- Use hierarchy deliberately: labels, row titles, values, helper text, and status text must not be nearly the same size/weight/color.
- Body copy should be readable, not tiny. Fine print must remain useful.
- Use uppercase only for short labels. Do not write body text in all caps.
- Keep letter spacing normal except short technical labels that already exist in the system.
- Long text needs wrapping, truncation, or a deliberate scroll affordance.

## Components

- Buttons need clear semantic variants: primary/active, neutral, destructive, success, warning, icon-only.
- Prefer icon buttons for obvious tool actions and include accessible labels/titles.
- Use toasts for transient success/error feedback instead of persistent inline status copy unless the state must remain visible.
- Use inline editors for single values. Do not use a dropdown when users need to supply arbitrary identifiers.
- Keep destructive actions visible enough to discover but visually secondary until invoked.

## Motion

- Motion must communicate state, continuity, or focus.
- Prefer opacity and transform.
- Avoid bounce, elastic overshoot, constant pulsing, or decorative wiggle.
- Respect perceived performance; no layout-property animation for routine UI.

## Copy

- Say it once, close to the control it describes.
- Prefer model/provider names and concrete state over explanatory prose.
- Error copy should name what failed and what the user can try next.
- Empty states should point to the next useful action.

## Anti-Slop Checklist

Before shipping UI, remove:

- Purple/cyan gradients used as default atmosphere.
- Gradient text.
- Neon glows that do not mark state.
- Generic feature-card grids.
- Rounded icon tile above every heading.
- Side-tab accent borders.
- Hairline border plus huge shadow on the same element.
- Extreme border radius on small cards/inputs.
- Cramped padding inside bordered controls.
- Low contrast labels.
- Repeated helper text that restates the label.
- Decorative SVG illustrations when real assets or no image would be better.

## Verification

For meaningful UI work:

- Run relevant tests.
- Run `pnpm --filter @sivraj/web build`.
- Run `npx react-doctor@latest --verbose` and fix actionable findings.
- Inspect the rendered UI when possible, especially drawer/modal/popover work, mobile width, and short viewport height.
