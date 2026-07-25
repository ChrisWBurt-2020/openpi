import { describe, expect, it } from 'vitest'
import { classifyNavigation, isExternallyOpenable } from '../electron/services/navigationPolicy'

/**
 * Regression: clicking a link in the transcript navigated the app's own window
 * away from the UI. There is no back button and no Back item in the app menu,
 * so the only escape was killing the app — which then lost the session.
 *
 * The MUST: nothing except the app itself may ever replace the app window.
 */

const DEV_APP = 'http://localhost:5173/'
const PACKAGED_APP = 'file:///C:/Program%20Files/OpenPi/resources/app/renderer/index.html'

describe('links the agent prints', () => {
  it('MUST NOT let a localhost dev server replace the app window', () => {
    // The exact case that was reported: agent prints http://localhost:3000,
    // user clicks it, app is gone.
    expect(classifyNavigation('http://localhost:3000/', DEV_APP)).toBe('external')
  })

  it('sends ordinary web links to the real browser', () => {
    expect(classifyNavigation('https://pi.dev/docs', DEV_APP)).toBe('external')
    expect(classifyNavigation('http://example.com', PACKAGED_APP)).toBe('external')
  })

  it('sends mailto to the mail client', () => {
    expect(classifyNavigation('mailto:someone@example.com', DEV_APP)).toBe('external')
  })
})

describe('the app navigating itself', () => {
  it('allows same-origin navigation so Vite HMR still works', () => {
    expect(classifyNavigation('http://localhost:5173/index.html', DEV_APP)).toBe('allow')
    expect(classifyNavigation(DEV_APP, DEV_APP)).toBe('allow')
  })

  it('treats a different port on localhost as a different app', () => {
    // Same host, different origin. This is the whole reported bug.
    expect(classifyNavigation('http://localhost:5174/', DEV_APP)).toBe('external')
  })

  it('allows reloading the packaged index.html', () => {
    expect(classifyNavigation(PACKAGED_APP, PACKAGED_APP)).toBe('allow')
  })
})

describe('things that must not reach the OS', () => {
  it('MUST NOT hand file:// URLs to shell.openExternal', () => {
    // shell.openExternal on a local path launches whatever app is registered
    // for it. Transcript content is model-generated; this is not a link we
    // should ever act on.
    expect(classifyNavigation('file:///C:/Windows/System32/calc.exe', DEV_APP)).toBe('block')
    expect(isExternallyOpenable('file:///etc/passwd')).toBe(false)
  })

  it('MUST NOT open arbitrary custom schemes', () => {
    expect(classifyNavigation('ms-msdt:/id', DEV_APP)).toBe('block')
    expect(classifyNavigation('javascript:alert(1)', DEV_APP)).toBe('block')
    expect(classifyNavigation('data:text/html,<h1>x', DEV_APP)).toBe('block')
  })

  it('blocks a different local file even when the app itself is file://', () => {
    // file:// origins all serialize to "null", so an origin comparison alone
    // would wrongly allow this. The path must be compared instead.
    expect(classifyNavigation('file:///C:/Users/someone/evil.html', PACKAGED_APP)).toBe('block')
  })

  it('blocks unparseable URLs rather than guessing', () => {
    expect(classifyNavigation('not a url', DEV_APP)).toBe('block')
    expect(classifyNavigation('', DEV_APP)).toBe('block')
  })
})

describe('when the app URL is unknown', () => {
  it('still routes web links outward and blocks the rest', () => {
    expect(classifyNavigation('https://pi.dev', null)).toBe('external')
    expect(classifyNavigation('file:///tmp/x', null)).toBe('block')
  })
})
