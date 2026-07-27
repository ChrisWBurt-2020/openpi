import { createSignal, onMount } from 'solid-js'

const DEFAULT_WIDTH = 296
const MIN_WIDTH = 264
const MAX_WIDTH = 380
const WIDTH_KEY = 'ui.navigator_width.v1'

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value))
}

export function useNavigatorLayout() {
  const [width, setWidth] = createSignal(DEFAULT_WIDTH)
  onMount(() => {
    void window.openpi
      .getPref(WIDTH_KEY)
      .then((value) => {
        const parsed = value ? Number.parseInt(value, 10) : Number.NaN
        if (!Number.isNaN(parsed)) setWidth(clampWidth(parsed))
      })
      .catch(() => undefined)
  })
  const startResize = (event: PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width()
    document.body.classList.add('navigator-resizing')
    const move = (next: PointerEvent) => setWidth(clampWidth(startWidth + next.clientX - startX))
    const stop = () => {
      document.body.classList.remove('navigator-resizing')
      void window.openpi.setPref(WIDTH_KEY, String(width()))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }
  const resizeBy = (delta: number) => {
    const next = clampWidth(width() + delta)
    setWidth(next)
    void window.openpi.setPref(WIDTH_KEY, String(next))
  }
  return { width, startResize, resizeBy }
}
