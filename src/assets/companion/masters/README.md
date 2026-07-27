# Heron companion masters

High-resolution raster source art for the five evidence-backed companion states
and the all-project Siege view.

| File | State | Required read |
| --- | --- | --- |
| `heron-idle-master.png` | Idle | Perched, calm |
| `heron-active-master.png` | Active | Flying |
| `heron-review-master.png` | Review | Standing alert, watching |
| `heron-blocked-master.png` | Blocked | Crouched with wing tucked across body |
| `heron-error-master.png` | Error | Braced beneath a restrained storm |
| `heron-siege-master.png` | Siege | All five states in one wide composition |
| `heron-mark-master.png` | Compact mark | Simplified head and neck for tray/rail exports |

These are tracing masters, not final runtime exports. The flat near-black
background and separated faceted regions are intentional: they make silhouette
review, background isolation, and manual SVG construction predictable.

When vectorizing:

- Preserve each pose's silhouette and state read.
- Keep the constellation nodes and faceted construction.
- Replace the master palette with project-scoped color tokens.
- Simplify detail progressively for full, mini, and tray sizes.
- Keep animation out of the artwork; only the error storm may animate in CSS.
