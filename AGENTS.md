# Engineering Standard

Build as if this is a production product, even for small changes.

- Prefer explicit domain state over inferred state from incidental side effects.
- Make durable product milestones backend/API-owned when they must survive reloads.
- Model lifecycle states with typed unions or enums.
- Keep UI branching behind named selectors or resolver functions.
- Design for reloads, reconnects, retries, partial failures, and legacy records.
- Add focused verification for the contract being changed.

When a quick fix would leave ambiguous state, flicker, or brittle inference, fix the model instead.

## Code style

- Prefer functional programming best practices: pure functions where practical, immutable data, explicit inputs/outputs, and small composable units over classes and hidden mutation.
- Keep files focused and short. Split modules before they grow unwieldy (rough guide: refactor or extract once a file is approaching ~300–500 lines).
- Use `@/` import path aliases (e.g. `@/components/...`) instead of long relative paths like `../../../` when the package supports them.

## File organization

- Type-only modules live in `src/types` and are grouped by domain, e.g. `chat.types.ts`, `worker.types.ts`, or `connector.types.ts`.
- Helper/util modules live inside a domain folder or shared lib folder, not as homeless root files.
- Avoid tiny one-off helper files unless they are genuinely reused or isolate complex logic.
- Prefer domain names over implementation-detail names.
- Keep route and job entrypoints thin; move pure parsing, formatting, and storage helpers into domain modules.

## React verification

- Before finishing React app work, run `npx react-doctor@latest` and address actionable findings so the app stays aligned with React best practices.

## Product design standard

- Before changing or creating UI, read `PRODUCT.md` and `DESIGN.md`; treat them as product context and design-system memory.
- Work in the product lane unless explicitly building marketing: dense, task-serving, stateful interfaces beat decorative page composition.
- Use the Impeccable-inspired loop captured in `DESIGN.md`: set context, shape the interaction, craft with existing primitives, polish, harden, and prevent drift.
- Avoid AI-design tells called out in `DESIGN.md`: generic card grids, nested cards, decorative glass, neon glow, gradient text, bloated copy, weak hierarchy, cramped controls, clipped popovers, and motion without state meaning.
- For frontend work, verify the rendered result with tests/builds and, when visual changes are meaningful, inspect the UI in a browser or screenshot before declaring it done.
