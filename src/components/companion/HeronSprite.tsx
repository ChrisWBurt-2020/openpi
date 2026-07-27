import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { CompanionProjectView } from '../../lib/companionView'
import type { PetClip, PetPackRuntime } from '../../lib/petPack'
import { Heron } from './Heron'
import { heronSpriteManifest } from './spriteManifest'

export interface SpriteClip {
  sheet: string
  frameWidth: number
  frameHeight: number
  frames: number
  fps: number
  reducedMotionFrame: number
  loop: boolean
  anchor: { x: number; y: number }
  hitbox: { x: number; y: number; width: number; height: number }
  paletteKeys: ('accent' | 'signal' | 'alert')[]
}

const imageCache = new Map<string, HTMLImageElement>()
const frameCache = new Map<string, HTMLCanvasElement>()

function spriteImage(sheet: string): HTMLImageElement {
  const existing = imageCache.get(sheet)
  if (existing) return existing
  const image = new Image()
  image.src = sheet
  imageCache.set(sheet, image)
  return image
}

function projectHue(color: string): number {
  const match = /hsl\((\d+)/.exec(color)
  return match ? Number(match[1]) : 198
}

function palette(hue: number) {
  return {
    accent: `hsl(${hue} 88% 62%)`,
    signal: `hsl(${(hue + 72) % 360} 84% 61%)`,
    alert: `hsl(${(hue + 318) % 360} 88% 64%)`,
  }
}

function recoloredFrame(clip: SpriteClip, frame: number, accent: string): HTMLCanvasElement | undefined {
  const index = frame % clip.frames
  const key = `${clip.sheet}:${index}:${accent}`
  const cached = frameCache.get(key)
  if (cached) return cached
  const image = spriteImage(clip.sheet)
  if (!image.complete || image.naturalWidth === 0) return undefined
  const raster = document.createElement('canvas')
  raster.width = clip.frameWidth
  raster.height = clip.frameHeight
  const context = raster.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  context.imageSmoothingEnabled = false
  context.drawImage(image, index * clip.frameWidth, 0, clip.frameWidth, clip.frameHeight, 0, 0, clip.frameWidth, clip.frameHeight)
  const pixels = context.getImageData(0, 0, raster.width, raster.height)
  const colors = palette(projectHue(accent))
  const swatches = Object.entries(colors).map(([key, css]) => {
    const probe = document.createElement('span')
    probe.style.color = css
    document.body.append(probe)
    const rgb = getComputedStyle(probe).color.match(/\d+/g)?.map(Number) ?? [255, 255, 255]
    probe.remove()
    return { key, rgb }
  })
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = pixels.data[offset]
    const green = pixels.data[offset + 1]
    const blue = pixels.data[offset + 2]
    const target = blue > 120 && green > 95 && red < 150 ? swatches[0]
      : red > 145 && green > 135 && blue < 130 ? swatches[1]
      : red > 160 && green < 165 && blue < 155 ? swatches[2]
      : undefined
    if (target) {
      pixels.data[offset] = target.rgb[0] ?? red
      pixels.data[offset + 1] = target.rgb[1] ?? green
      pixels.data[offset + 2] = target.rgb[2] ?? blue
    }
  }
  context.putImageData(pixels, 0, 0)
  frameCache.set(key, raster)
  return raster
}

export interface SpriteManifest {
  clips: Record<string, SpriteClip>
}

interface Props {
  view: CompanionProjectView
  manifest?: SpriteManifest
  size?: number
  rail?: boolean
  paused?: boolean
}

function clipFor(view: CompanionProjectView): string {
  return view.sprite.clipId
}

/**
 * Display-only transparent-raster frame host. The art sheet is deliberately
 * external to this component: main-owned truth selects state, while the
 * renderer merely plays the declared frame or uses the semantic SVG fallback.
 */
export function HeronSprite(props: Props) {
  let canvas: HTMLCanvasElement | undefined
  let animation = 0
  const [runtime, setRuntime] = createSignal<PetPackRuntime | null>(null)
  const [customFrame, setCustomFrame] = createSignal(0)
  const size = () => props.size ?? (props.rail ? 24 : 160)
  const clip = createMemo(() => {
    const manifest = props.manifest ?? heronSpriteManifest
    return manifest.clips[clipFor(props.view)] ?? manifest.clips[props.view.state.kind]
  })
  const reducedMotion = () => props.view.profile.appearance.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const bridge = () => (typeof window.heron === 'undefined' ? window.openpi.companion : window.heron)
  const customClip = createMemo<PetClip | null>(() => {
    const pack = runtime()
    if (!pack) return null
    const desired = props.view.sprite.clipId
    const id = pack.clips.some((clip) => clip.id === desired) ? desired : pack.fallbacks[desired] ?? props.view.state.kind
    return pack.clips.find((clip) => clip.id === id) ?? pack.clips.find((clip) => clip.id === 'idle') ?? null
  })

  const draw = (frame: number) => {
    const target = canvas
    const selected = clip()
    if (!target || !selected) return
    const context = target.getContext('2d')
    const raster = recoloredFrame(selected, frame, props.view.sprite.palette.accent)
    if (!context || !raster) return
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, target.width, target.height)
    context.drawImage(raster, 0, 0, raster.width, raster.height, 0, 0, target.width, target.height)
  }

  createEffect(() => {
    const selected = clip()
    if (!selected) return
    const image = spriteImage(selected.sheet)
    image.addEventListener('load', () => draw(reducedMotion() ? selected.reducedMotionFrame : 0), { once: true })
    draw(reducedMotion() ? selected.reducedMotionFrame : 0)
  })
  createEffect(() => {
    const id = props.view.profile.appearance.petPackId
    if (id === 'builtin-graphic-heron') {
      setRuntime(null)
      return
    }
    void bridge().getPack(id).then(setRuntime).catch(() => setRuntime(null))
  })
  onMount(() => {
    let frame = 0
    let lastAt = 0
    const tick = (at: number) => {
      const selected = clip()
      const packClip = customClip()
      if (packClip && !props.paused && props.view.profile.appearance.motion !== 'paused' && !document.hidden && !reducedMotion()) {
        const frame = packClip.frames[customFrame() % packClip.frames.length]
        if (frame && at - lastAt >= frame.durationMs) {
          setCustomFrame((value) => packClip.loop ? (value + 1) % packClip.frames.length : Math.min(value + 1, packClip.frames.length - 1))
          lastAt = at
        }
      } else if (selected && !props.paused && props.view.profile.appearance.motion !== 'paused' && !document.hidden && !reducedMotion()) {
        if (at - lastAt >= Math.max(100, 1000 / selected.fps)) {
          frame = selected.loop ? (frame + 1) % selected.frames : Math.min(frame + 1, selected.frames - 1)
          draw(frame)
          lastAt = at
        }
      }
      animation = window.requestAnimationFrame(tick)
    }
    animation = window.requestAnimationFrame(tick)
    onCleanup(() => {
      window.cancelAnimationFrame(animation)
    })
  })

  return (
    <Show
      when={runtime()}
      fallback={
        <Show
          when={clip()}
          fallback={
            <Heron
              state={props.view.state}
              class="heron-sprite-fallback"
              label={`${props.view.profile.displayName}: ${props.view.state.kind}`}
            />
          }
        >
          <canvas
            ref={canvas}
            class={`heron-sprite${props.rail ? ' heron-sprite-rail' : ''}`}
            width={size()}
            height={size()}
            style={{ width: `${size()}px`, height: `${size()}px` }}
            role="img"
            aria-label={`${props.view.profile.displayName}: ${props.view.state.kind}`}
          />
        </Show>
      }
    >
      {(pack) => {
        const clip = customClip()
        const frame = () => clip?.frames[reducedMotion() ? clip.reducedMotionFrame : customFrame() % (clip?.frames.length ?? 1)]
        return (
          <div
            class={`heron-sprite heron-custom-sprite${props.rail ? ' heron-sprite-rail' : ''}`}
            role="img"
            aria-label={`${props.view.profile.displayName}: ${props.view.state.kind}`}
            style={{
              width: `${size()}px`, height: `${size()}px`,
              'background-image': `url("${props.rail && pack().railAtlasUrl ? pack().railAtlasUrl : pack().atlasUrl}")`,
              'background-size': `${pack().atlas.columns * 100}% ${pack().atlas.rows * 100}%`,
              'background-position': `${((frame()?.column ?? 0) / Math.max(1, pack().atlas.columns - 1)) * 100}% ${((frame()?.row ?? 0) / Math.max(1, pack().atlas.rows - 1)) * 100}%`,
              'image-rendering': pack().renderMode === 'pixelated' ? 'pixelated' : 'auto',
              '--heron-accent': props.view.sprite.palette.accent,
            }}
          />
        )
      }}
    </Show>
  )
}
