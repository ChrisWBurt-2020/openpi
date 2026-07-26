/**
 * navigationPolicy.ts — decide what happens when something tries to navigate
 * the app window.
 *
 * Without this, clicking any link in the transcript navigates the app's own
 * BrowserWindow away from the UI. There is no back button and no Back item in
 * the app menu, so the only way out is to kill the app — which is exactly how
 * this bug was found. A link to a localhost dev server is the common case,
 * since the agent prints those constantly.
 *
 * Rules:
 *   allow    — same-origin navigation (Vite HMR, in-app routing). Nothing else
 *              is ever allowed to replace the app window.
 *   external — http/https/mailto go to the user's real browser or mail client.
 *   block    — everything else. file://, custom schemes and the like get
 *              dropped rather than handed to the OS, because handing an
 *              arbitrary scheme to shell.openExternal launches whatever app is
 *              registered for it, from content the model may have produced.
 */

export type NavigationDecision = 'allow' | 'external' | 'block'

/** Schemes we are willing to hand to the OS. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * @param targetUrl where the navigation wants to go
 * @param appUrl    the URL the app itself is served from — the dev server in
 *                  development, a file:// path when packaged
 */
export function classifyNavigation(targetUrl: string, appUrl: string | null): NavigationDecision {
  const target = parse(targetUrl)
  if (!target) return 'block'

  const app = appUrl ? parse(appUrl) : null

  if (app) {
    // Packaged builds are file:// and have origin "null", which would compare
    // equal for ANY file:// URL. Compare paths instead so a link to some other
    // local file can't replace the app.
    if (app.protocol === 'file:') {
      if (target.protocol === 'file:' && target.pathname === app.pathname) return 'allow'
    } else if (target.origin === app.origin) {
      // Same origin covers Vite HMR reloads and in-app routing. Note this is
      // origin, not host: a different PORT on localhost is a different app and
      // opens externally, which is the dev-server-link case.
      return 'allow'
    }
  }

  return EXTERNAL_SCHEMES.has(target.protocol) ? 'external' : 'block'
}

/** True when this URL may be handed to the OS. */
export function isExternallyOpenable(url: string): boolean {
  const parsed = parse(url)
  return parsed !== null && EXTERNAL_SCHEMES.has(parsed.protocol)
}
