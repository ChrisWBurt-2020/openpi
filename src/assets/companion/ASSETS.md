# Heron visual asset library

High-resolution raster masters generated for later tracing, simplification, and
animation. These are source artwork rather than runtime exports.

## Loading

| File | Main-owned phase | Intended motion |
| --- | --- | --- |
| `loading/loading-session-master.png` | Opening session / starting Pi | Heron follows orbit slowly |
| `loading/loading-history-master.png` | Loading session history | Nodes resolve left to right |
| `loading/loading-operation-master.png` | Verified operation pending | Feather rotates around its center |

Loading text must come from validated main-process state. Never choose a phase
from elapsed time or renderer observation.

## Notification marks

| File | Meaning |
| --- | --- |
| `status/status-success-master.png` | Successful completion |
| `status/status-review-master.png` | Review available |
| `status/status-blocked-master.png` | Waiting for required input |
| `status/status-warning-master.png` | Caution / degraded state |
| `status/status-error-master.png` | Verified failure |

These masters deliberately avoid letters and platform-generic badges. Preserve
their silhouettes when reducing them to 16, 20, 24, and 32 pixels.

## First-run onboarding

| File | Step | Copy-safe area |
| --- | --- | --- |
| `onboarding/onboarding-open-project-master.png` | Open a project | Right |
| `onboarding/onboarding-work-with-pi-master.png` | Work with Pi | Left |
| `onboarding/onboarding-review-changes-master.png` | Review changes | Right |

Keep onboarding copy in accessible HTML; do not bake text into exports.

## Production guidance

- Trace masters into SVG with broad facets rather than automatic high-detail
  vectorization.
- Replace the master palette with theme and project-scoped color tokens.
- Create separate full, mini, and tray reductions; do not merely scale down.
- Use CSS or Web Animations so reduced-motion can disable every loop.
- Keep idle surfaces static. Loading may move slowly; completion moves once;
  repeating storm motion is reserved for verified errors.
