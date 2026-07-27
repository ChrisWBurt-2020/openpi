# Companion illustration atlas

High-resolution raster masters for future companion presentation work. These are visual source
assets, never a source of application state. The Electron main process remains the authority for
project companion state and evidence.

| Asset | Size | Intended material |
| --- | --- | --- |
| `state-portrait-atlas-master.png` | 1254×1254 | The five canonical companion poses: idle, active, review, blocked, error. |
| `evidence-atlas-master.png` | 1254×1254 | Evidence-source cards for command output, Git changes, review, failure, and user input. |
| `siege-scene-master.png` | 1672×941 | Wide background for the all-project Siege view; retain clear areas for real project cards. |
| `desktop-pet-atlas-master.png` | 1254×1254 | Hover, pin, drag, rest, attention, and recovery interaction poses. |
| `utility-atlas-master.png` | 1254×1254 | Transition keyframes, review, recovery, and quiet empty-state material. |
| `accessibility-silhouette-atlas-master.png` | 1254×1254 | High-contrast pose references for small or reduced-vision surfaces. |

## Use rules

- Crop/export derived assets non-destructively; preserve these masters.
- Keep state poses colorable or paired with the existing semantic state label and evidence ref.
- Do not animate a raster by default. Any later motion must honor `prefers-reduced-motion`.
- The Siege is a collection of projects; do not call it a flock.
