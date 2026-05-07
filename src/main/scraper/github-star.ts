import puppeteer, { type Page } from 'puppeteer-core'
import { findChrome, sleep } from './utils'
import { injectOverlay, removeOverlay, pollOverlayResult } from './browser-ui'
import type { LogFn } from './types'
import type { StarResult } from '../../shared/types'

const REPO_URL = 'https://github.com/mahmadabid/vibed-puppet'
const LOGIN_URL = 'https://github.com/login'

// ── Login detection ───────────────────────────────────────────────────────────

async function checkGitHubLogin(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const url = window.location.href

    // Definitely not logged in
    if (url.includes('/login') || url.includes('/session')) return false

    // Logged-in signals — GitHub uses several over time
    if (document.querySelector('meta[name="user-login"]')) {
      const meta = document.querySelector('meta[name="user-login"]') as HTMLMetaElement
      if (meta.content && meta.content.length > 0) return true
    }
    // React-based nav (newer GitHub)
    if (document.querySelector('[aria-label="View profile and more"]')) return true
    if (document.querySelector('[data-login]')) return true
    if (document.querySelector('.AppHeader-user')) return true
    // Avatar in nav
    if (document.querySelector('img.avatar.avatar-user')) return true
    // "Sign out" link in dropdowns
    if (document.querySelector('[action="/logout"]')) return true

    // Not logged in signals
    if (document.querySelector('a[href="/login"]')?.textContent?.trim() === 'Sign in') return false

    return false
  }) as Promise<boolean>
}

// ── Star status ───────────────────────────────────────────────────────────────

async function getStarStatus(page: Page): Promise<'starred' | 'unstarred' | 'unknown'> {
  return page.evaluate(() => {
    // Strategy 1: aria-label on the star form button
    const starFormBtn = document.querySelector(
      'form[action*="/star"] button, button[aria-label*="Star"], button[aria-label*="Unstar"]'
    ) as HTMLButtonElement | null
    if (starFormBtn) {
      const label = starFormBtn.getAttribute('aria-label') ?? ''
      if (label.toLowerCase().includes('unstar')) return 'starred'
      if (label.toLowerCase().includes('star')) return 'unstarred'
    }

    // Strategy 2: the classic .js-toggler-target span text
    const togglerSpan = document.querySelector('.js-toggler-target') as HTMLElement | null
    if (togglerSpan) {
      const t = togglerSpan.textContent?.trim().toLowerCase() ?? ''
      if (t === 'starred') return 'starred'
      if (t === 'star') return 'unstarred'
    }

    // Strategy 3: look for any "Unstar" text on the page
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[]
    for (const b of allBtns) {
      const txt = b.textContent?.trim().toLowerCase() ?? ''
      if (txt === 'unstar' || txt.includes('unstar this')) return 'starred'
      if (txt === 'star' || txt === 'star this repository') return 'unstarred'
    }

    return 'unknown'
  }) as Promise<'starred' | 'unstarred' | 'unknown'>
}

// ── Click star ────────────────────────────────────────────────────────────────

async function clickStar(page: Page, log: LogFn): Promise<boolean> {
  // Strategy 1: form action="/star" submit button
  const clicked1 = await page.evaluate(() => {
    const form = document.querySelector('form[action*="/star"]:not([action*="/unstar"])') as HTMLFormElement | null
    if (form) {
      const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null
      if (btn && !btn.disabled) { btn.click(); return true }
    }
    return false
  }) as boolean
  if (clicked1) { log('  Clicked via form[action*="/star"]'); return true }

  // Strategy 2: aria-label Star button
  const clicked2 = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => {
      const label = b.getAttribute('aria-label') ?? ''
      const txt   = b.textContent?.trim() ?? ''
      return (label.toLowerCase().includes('star') && !label.toLowerCase().includes('unstar')) ||
             (txt.toLowerCase() === 'star')
    }) as HTMLButtonElement | undefined
    if (btn && !btn.disabled) { btn.click(); return true }
    return false
  }) as boolean
  if (clicked2) { log('  Clicked via aria-label/text Star button'); return true }

  // Strategy 3: .js-toggler-target inside a star-count form
  const clicked3 = await page.evaluate(() => {
    const containers = document.querySelectorAll('.starring-container, [data-hydro-view*="star"]')
    for (const c of containers) {
      const btn = c.querySelector('button') as HTMLButtonElement | null
      if (btn && !btn.disabled) { btn.click(); return true }
    }
    return false
  }) as boolean
  if (clicked3) { log('  Clicked via starring-container'); return true }

  return false
}

// ── Persistent login wait ─────────────────────────────────────────────────────

async function waitForGitHubLogin(page: Page, log: LogFn): Promise<boolean> {
  let attempt = 0

  while (true) {
    attempt++
    const isFirst = attempt === 1

    await injectOverlay(page, {
      message: isFirst
        ? "You're not logged in to GitHub.\n\nSign in on this page — the URL may change, that's fine.\nOnce you see your GitHub home, click I'm logged in."
        : `Still waiting for GitHub login (check ${attempt})…\nSign in and click I'm logged in.`,
      buttons: [
        { label: "I'm logged in ✓", action: 'continue', primary: true },
        { label: 'Cancel', action: 'cancel' },
      ],
    })

    const pollMs  = isFirst ? 90_000 : 30_000
    const deadline = Date.now() + pollMs

    while (Date.now() < deadline) {
      await sleep(1500)

      // Check overlay button
      const result = await pollOverlayResult(page).catch(() => null)
      if (result === 'cancel') { log('Cancelled by user.'); return false }
      if (result === 'continue') {
        await sleep(1500)
        if (await checkGitHubLogin(page)) { await removeOverlay(page); return true }
        log('  Not detected as logged in yet, re-showing overlay…')
        break // re-inject
      }

      // Auto-detect
      if (await checkGitHubLogin(page)) {
        log('  Login auto-detected ✓')
        await removeOverlay(page)
        return true
      }

      // Re-inject if navigated away
      const hasOverlay = await page.evaluate(() => !!document.getElementById('__vp_overlay__')).catch(() => false)
      if (!hasOverlay) {
        await injectOverlay(page, {
          message: `Sign in to GitHub, then click I'm logged in ✓

(attempt ${attempt})`,
          buttons: [
            { label: "I'm logged in ✓", action: 'continue', primary: true },
            { label: 'Cancel', action: 'cancel' },
          ],
        }).catch(() => {})
      }
    }

    // After timeout — check one more time before looping
    if (await checkGitHubLogin(page)) { await removeOverlay(page); return true }
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

export async function runGitHubStar(chromePath: string, log: LogFn): Promise<StarResult> {
  const executablePath = findChrome()
  if (!executablePath) return { success: false, error: 'Chrome not found. Install Google Chrome.' }

  log('Opening GitHub…')

  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    defaultViewport: null,
    userDataDir: chromePath,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--start-maximized','--no-first-run','--no-default-browser-check','--disable-blink-features=AutomationControlled'],
  })

  const [page] = await browser.pages()
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  try {
    // Go straight to repo page — if already logged in this is all we need
    await page.goto(REPO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(2000)

    // Login check
    if (!(await checkGitHubLogin(page))) {
      log('Not logged in to GitHub — showing sign-in overlay.')

      // Navigate to login so the user has a form to fill in
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(1000)

      const loggedIn = await waitForGitHubLogin(page, log)
      if (!loggedIn) return { success: false, error: 'Cancelled — not logged in.' }

      // After login, navigate to the repo
      log('Navigating to repo…')
      await page.goto(REPO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(2000)
    }

    log('Checking star status…')
    let starStatus = await getStarStatus(page)
    log(`  Star status: ${starStatus}`)

    // If unknown, try scrolling to make sure the star area is rendered
    if (starStatus === 'unknown') {
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(1000)
      starStatus = await getStarStatus(page)
      log(`  Star status after scroll: ${starStatus}`)
    }

    if (starStatus === 'starred') {
      log('⭐ Already starred!')
      await injectOverlay(page, {
        message: `⭐ You already have vibed-puppet starred!

Thank you for your support! 🙌`,
        buttons: [{ label: 'Close', action: 'close', primary: true }],
      })
      await sleep(2500)
      return { success: true, alreadyStarred: true }
    }

    if (starStatus === 'unknown') {
      // Fallback: show overlay and let user star manually
      log('  Star button not found automatically — asking user to star manually.')
      await injectOverlay(page, {
        message: 'Could not find the Star button automatically.\n\nPlease click the Star (⭐) button at the top of the page,\nthen click I starred it.',
        buttons: [
          { label: "I starred it ✓", action: 'done', primary: true },
          { label: 'Cancel', action: 'cancel' },
        ]})

      const deadline = Date.now() + 5 * 60 * 1000
      while (Date.now() < deadline) {
        await sleep(1000)
        const r = await pollOverlayResult(page).catch(() => null)
        if (r === 'cancel') return { success: false, error: 'Cancelled by user.' }
        if (r === 'done') {
          log('User confirmed they starred manually.')
          return { success: true, alreadyStarred: false }
        }
      }
      return { success: false, error: 'Timed out waiting for manual star.' }
    }

    // Click the star button
    log('Starring repo…')
    const clicked = await clickStar(page, log)

    if (!clicked) {
      // Last resort: try clicking via keyboard shortcut or direct API not available — ask user
      log('  Could not click star button automatically, asking user.')
      await injectOverlay(page, {
        message: 'Almost there!\nClick the Star (⭐) button at the top of the page,\nthen click Done.',
        buttons: [
          { label: 'Done ✓', action: 'done', primary: true },
          { label: 'Cancel', action: 'cancel' },
        ],
      })
      const deadline = Date.now() + 3 * 60 * 1000
      while (Date.now() < deadline) {
        await sleep(800)
        const r = await pollOverlayResult(page).catch(() => null)
        if (r === 'cancel') return { success: false, error: 'Cancelled.' }
        if (r === 'done') return { success: true, alreadyStarred: false }
      }
      return { success: false, error: 'Timed out.' }
    }

    // Wait and confirm star toggled
    await sleep(2000)
    const newStatus = await getStarStatus(page)
    log(`  Star status after click: ${newStatus}`)

    if (newStatus === 'starred') {
      log('⭐ Successfully starred vibed-puppet!')
      await injectOverlay(page, {
        message: `⭐ Thank you for starring vibed-puppet!

Your support means a lot. 🙌`,
        buttons: [{ label: '🎉 Awesome!', action: 'close', primary: true }],
      })
      await sleep(3000)
      return { success: true, alreadyStarred: false }
    }

    // Handle "you need to sign in to star" modal that GitHub sometimes shows
    const needsSignIn = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]')
      return modal?.textContent?.toLowerCase().includes('sign in') ?? false
    }) as boolean

    if (needsSignIn) {
      log('  GitHub opened a sign-in modal — session may have expired.')
      return { success: false, error: 'GitHub session expired. Go to Settings → Reset Profile and try again.' }
    }

    return { success: false, error: 'Star state did not change after clicking. Try manually on GitHub.' }

  } catch (err: any) {
    log(`❌ GitHub star error: ${err.message}`)
    return { success: false, error: err.message }
  } finally {
    await browser.close()
  }
}
