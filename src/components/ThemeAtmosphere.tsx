import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import constellation from '../assets/themes/constellation.svg'
import forest from '../assets/themes/forest.svg'
import heron from '../assets/themes/heron.svg'
import naturalHeron from '../assets/themes/natural-heron.svg'

export function ThemeAtmosphere() {
  const [theme, setTheme] = createSignal(document.documentElement.dataset.openpiTheme ?? '')
  onMount(() => {
    const sync = () => setTheme(document.documentElement.dataset.openpiTheme ?? '')
    window.addEventListener('openpi:theme-changed', sync)
    onCleanup(() => window.removeEventListener('openpi:theme-changed', sync))
  })
  return (
    <Show when={theme() === 'heron-flight' || theme() === 'natural-focus'}>
      <div class="theme-atmosphere" aria-hidden="true" data-theme={theme()}>
        <Show when={theme() === 'heron-flight'}>
          <img class="theme-atmosphere-constellation" src={constellation} alt="" />
          <img class="theme-atmosphere-heron" src={heron} alt="" />
        </Show>
        <Show when={theme() === 'natural-focus'}>
          <img class="theme-atmosphere-forest" src={forest} alt="" />
          <img class="theme-atmosphere-heron" src={naturalHeron} alt="" />
        </Show>
      </div>
    </Show>
  )
}
