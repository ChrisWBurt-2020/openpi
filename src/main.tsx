/* @refresh reload */
import { render } from 'solid-js/web'
import App from './App'
import { Pet } from './components/companion/Pet'
import './index.css'
import '@xterm/xterm/css/xterm.css'
import { restoreThemeFromStorage } from './lib/themeApply'

restoreThemeFromStorage()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

render(
  () => (new URLSearchParams(window.location.search).has('companion') ? <Pet /> : <App />),
  root
)
