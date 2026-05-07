import puppeteer, { type Browser, type Page, type ElementHandle } from 'puppeteer-core'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { sleep, findChrome, loadLog, saveLog } from './utils'
import { injectOverlay, removeOverlay, updateOverlayMessage, pollOverlayResult } from './browser-ui'
import type { LogFn, XCleanerOptions, XOperation, XFilters, DeletedEntry, UnlikedEntry } from './types'
import type { RunSummary } from '../../shared/types'
export type { RunSummary }

// ── Browser setup ─────────────────────────────────────────────────────────────

async function launchBrowser(chromePath: string): Promise<Browser> {
  const executablePath = findChrome()
  if (!executablePath) throw new Error('Chrome not found. Install Google Chrome and retry.')
  return puppeteer.launch({
    executablePath, headless: false, defaultViewport: null,
    userDataDir: chromePath,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--start-maximized','--no-first-run','--no-default-browser-check','--disable-blink-features=AutomationControlled'],
  })
}

async function setupPage(browser: Browser, rateLimited: { value: boolean }): Promise<Page> {
  const [page] = await browser.pages()
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  await page.setRequestInterception(true)
  const ALLOWED = ['x.com', 'abs.twimg.com', 'pbs.twimg.com', 'api.x.com', 't.co', 'twitter.com']
  page.on('request', req => {
    if (req.resourceType() === 'document') {
      try {
        const host = new URL(req.url()).hostname
        if (!ALLOWED.some(h => host === h || host.endsWith('.' + h))) { req.abort(); return }
      } catch {}
    }
    req.continue()
  })
  page.on('response', res => {
    if (res.status() === 429 && /DeleteTweet|FavoriteTweet|UnfavoriteTweet/.test(res.url()))
      rateLimited.value = true
  })
  return page
}

// ── Login detection ───────────────────────────────────────────────────────────

async function checkLoggedIn(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const url = window.location.href
      // Definitely not logged in if on login/flow pages
      if (url.includes('/login') || url.includes('/i/flow/login')) return false
      // Logged out indicators
      if (document.querySelector('a[href="/login"]')) return false
      if (document.querySelector('[data-testid="loginButton"]')) return false
      const btns = Array.from(document.querySelectorAll('a,button'))
      if (btns.some(el => (el as HTMLElement).innerText?.trim() === 'Sign in')) return false
      // Logged in indicators
      if (document.querySelector('[data-testid="AppTabBar_Profile_Link"]')) return true
      if (document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')) return true
      if (document.querySelector('[aria-label="Profile"]')) return true
      // On home with no login link = logged in
      if (url.includes('/home')) return true
      return false
    })
  } catch { return false }
}

/**
 * Persistent login wait:
 * - Shows overlay that stays through page navigations (re-injected on each check)
 * - First check immediately, second after 60s, then every 30s
 * - Also responds to user clicking "I'm logged in" button
 * - Never closes the browser
 */
async function waitForLogin(page: Page, log: LogFn): Promise<void> {
  let attempt = 0

  const message = (att: number) => att === 0
    ? "You're not logged in to X.\n\nSign in on this page — the URL may change, that's fine.\nOnce you see your home feed, click I'm logged in."
    : `Still waiting for login (check ${att + 1})…\nAuto-checking every 30s.\n\nOnce you see your home feed, click I'm logged in.`

  while (true) {
    attempt++
    log(`  Waiting for login (check #${attempt})…`)

    // Always re-inject overlay — it may have been lost on navigation
    try {
      await injectOverlay(page, {
        message: message(attempt - 1),
        buttons: [{ label: "I'm logged in ✓", action: 'continue', primary: true }],
      })
    } catch { /* page may be navigating, ignore */ }

    // Poll for up to 60s on first attempt, 30s after
    const waitMs = attempt === 1 ? 60_000 : 30_000
    const deadline = Date.now() + waitMs

    while (Date.now() < deadline) {
      await sleep(2000)

      // Check if user clicked the overlay button
      const result = await pollOverlayResult(page).catch(() => null)
      if (result === 'continue') {
        log('  User clicked "I\'m logged in" — verifying…')
        await sleep(2000)
        if (await checkLoggedIn(page)) { await removeOverlay(page); return }
        log('  Not detected as logged in yet, still waiting…')
        break // re-inject overlay on next loop
      }

      // Auto-detect login (handles URL change on successful login)
      if (await checkLoggedIn(page)) {
        log('  Login detected automatically ✓')
        await removeOverlay(page)
        return
      }

      // Re-inject overlay if it disappeared due to navigation
      const hasOverlay = await page.evaluate(() => !!document.getElementById('__vp_overlay__')).catch(() => false)
      if (!hasOverlay) {
        try {
          await injectOverlay(page, {
            message: message(attempt - 1),
            buttons: [{ label: "I'm logged in ✓", action: 'continue', primary: true }],
          })
        } catch {}
      }
    }

    // After timeout, check once more
    if (await checkLoggedIn(page)) { await removeOverlay(page); return }
  }
}

// ── Username detection ────────────────────────────────────────────────────────

async function detectUsername(page: Page, log: LogFn): Promise<string | null> {
  // Navigate to home to get the sidebar rendered
  const currentUrl = page.url()
  if (!currentUrl.includes('x.com/home')) {
    log('  Navigating to home for username detection…')
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
  }
  // Wait up to 8s for React to render the sidebar
  await sleep(3000)

  // Strategy 1: known test IDs (try both capitalizations X has used)
  const testIds = [
    '[data-testid="AppTabBar_Profile_Link"]',
    '[data-testid="AppTabBar_Profile_link"]',  // lowercase l variant
  ]
  for (const sel of testIds) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 })
      const handle = await page.evaluate(s => {
        const el = document.querySelector(s) as HTMLAnchorElement | null
        const href = el?.getAttribute('href') ?? ''
        // href is like "/username" — strip leading slash and query string
        return href.replace('/', '').split('?')[0].split('/')[0] || null
      }, sel)
      if (handle && !['home','explore','notifications','messages','i','settings'].includes(handle)) {
        log(`  Username via ${sel}: @${handle}`)
        return handle
      }
    } catch {}
  }

  // Strategy 2: any nav link whose href looks like a profile path
  const fromNav = await page.evaluate(() => {
    const nav = document.querySelector('nav') ?? document.querySelector('[role="navigation"]')
    if (!nav) return null
    const links = Array.from(nav.querySelectorAll('a[href]')) as HTMLAnchorElement[]
    const bad = new Set(['','home','explore','notifications','messages','i','settings','lists','bookmarks','communities','premium'])
    for (const a of links) {
      const parts = (a.getAttribute('href') ?? '').split('/').filter(Boolean)
      if (parts.length === 1 && !bad.has(parts[0]) && /^[A-Za-z0-9_]{1,50}$/.test(parts[0]))
        return parts[0]
    }
    return null
  })
  if (fromNav) { log(`  Username via nav scan: @${fromNav}`); return fromNav }

  // Strategy 3: click the Profile link and read the URL
  try {
    // Find profile link by aria-label
    const profileLink = await page.$('[aria-label="Profile"]')
    if (profileLink) {
      const href = await page.evaluate(el => (el as HTMLAnchorElement).getAttribute('href'), profileLink)
      const username = href?.replace('/', '').split('?')[0]
      if (username && username.length > 0) { log(`  Username via aria-label Profile: @${username}`); return username }
    }
  } catch {}

  // Strategy 4: account switcher button — contains screen_name in DOM
  const fromSwitcher = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
    if (!btn) return null
    // The switcher often has the @handle as text inside
    const text = (btn as HTMLElement).innerText ?? ''
    const match = text.match(/@([A-Za-z0-9_]+)/)
    return match ? match[1] : null
  })
  if (fromSwitcher) { log(`  Username via account switcher: @${fromSwitcher}`); return fromSwitcher }

  // Strategy 5: look in page source for screen_name JSON blob
  const fromBlob = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script'))
    for (const s of scripts) {
      const t = s.textContent ?? ''
      const m = t.match(/"screen_name":"([A-Za-z0-9_]+)"/)
      if (m) return m[1]
    }
    return null
  })
  if (fromBlob) { log(`  Username via script blob: @${fromBlob}`); return fromBlob }

  return null
}

// ── Filter evaluation ─────────────────────────────────────────────────────────

interface TweetMeta {
  text: string; tweetId: string|null; postedAt: string|null
  likes: number; replyCount: number; isPinned: boolean
  repliedToHandle: string|null; repliedToUrl: string|null
}

async function extractMeta(page: Page, el: ElementHandle<Element>, handle: string): Promise<TweetMeta> {
  return page.evaluate((node, h) => {
    const text     = (node.querySelector('[data-testid="tweetText"]') as HTMLElement|null)?.innerText?.trim() ?? ''
    const postedAt = node.querySelector('time')?.getAttribute('datetime') ?? null
    const isPinned = !!(node.querySelector('[data-testid="socialContext"]') as HTMLElement|null)?.innerText?.includes('Pinned')
    const parseStat = (el: Element|null): number => {
      const lbl = el?.getAttribute('aria-label') ?? ''
      const m = lbl.match(/([\d,]+(\.\d+)?)\s*K?M?/)
      if (!m) return 0
      const n = parseFloat(m[1].replace(/,/g, ''))
      if (lbl.includes('K')) return n * 1000
      if (lbl.includes('M')) return n * 1_000_000
      return n
    }
    const likes      = parseStat(node.querySelector('[data-testid="like"],[data-testid="unlike"]'))
    const replyCount = parseStat(node.querySelector('[data-testid="reply"]'))
    const links      = Array.from(node.querySelectorAll('a[href*="/status/"]')) as HTMLAnchorElement[]
    const ownLink    = links.find(l => l.getAttribute('href')?.split('/')?.[1]?.toLowerCase() === h)
    const tweetId    = ownLink?.getAttribute('href')?.split('/status/')?.[1] ?? null
    let repliedToHandle: string|null = null, repliedToUrl: string|null = null
    let parent = node.parentElement
    for (let i = 0; i < 12; i++) {
      if (!parent) break
      for (const t of parent.querySelectorAll('article[data-testid="tweet"]')) {
        const l = t.querySelector('a[href*="/status/"]') as HTMLAnchorElement|null
        const lh = l?.getAttribute('href')?.split('/')?.[1]?.toLowerCase()
        if (lh && lh !== h) { repliedToHandle = lh; repliedToUrl = 'https://x.com' + l!.getAttribute('href'); break }
      }
      if (repliedToHandle) break
      parent = parent.parentElement
    }
    return { text, tweetId, postedAt, likes, replyCount, isPinned, repliedToHandle, repliedToUrl }
  }, el, handle) as Promise<TweetMeta>
}

function passesFilters(meta: TweetMeta, filters: XFilters, tab: XOperation): boolean {
  if (filters.skipPinned && meta.isPinned) return false
  if (meta.postedAt) {
    const d = meta.postedAt.slice(0, 10)
    if (filters.dateFrom && d < filters.dateFrom) return false
    if (filters.dateTo   && d > filters.dateTo)   return false
  }
  if (filters.keywords?.length) {
    const lower = meta.text.toLowerCase()
    if (!filters.keywords.every(kw => lower.includes(kw.toLowerCase()))) return false
  }
  if (tab === 'replies') {
    if (filters.replyToPostUrl && meta.repliedToUrl) {
      const n = (u: string) => u.replace(/\/$/, '').toLowerCase()
      if (!n(meta.repliedToUrl).includes(n(filters.replyToPostUrl))) return false
    }
    if (filters.replyToUser) {
      if (meta.repliedToHandle?.toLowerCase() !== filters.replyToUser.replace('@','').toLowerCase()) return false
    }
  }
  if (filters.maxLikes   !== undefined && meta.likes      >= filters.maxLikes)   return false
  if (filters.maxReplies !== undefined && meta.replyCount >= filters.maxReplies) return false
  return true
}

// ── Tweet finder ──────────────────────────────────────────────────────────────

async function findOwnTweet(page: Page, handle: string): Promise<ElementHandle<Element>|null> {
  const tweets = await page.$$('[data-testid="tweet"]')
  for (const t of tweets) {
    const match = await page.evaluate((el, h) => {
      const link   = el.querySelector('a[href*="/status/"]') as HTMLAnchorElement|null
      const author = link?.getAttribute('href')?.split('/')?.[1]?.toLowerCase()
      if (author === h) return true
      const ctx = el.querySelector('[data-testid="socialContext"]') as HTMLElement|null
      return ctx?.innerText?.toLowerCase().includes('reposted') ?? false
    }, t, handle) as boolean
    if (match) return t
  }
  return null
}

async function confirmDelete(page: Page): Promise<void> {
  try {
    await page.waitForSelector('[data-testid="confirmationSheetConfirm"]', { timeout: 3000 })
    await page.click('[data-testid="confirmationSheetConfirm"]')
  } catch {
    await page.evaluate(() => {
      (Array.from(document.querySelectorAll('[role="button"]'))
        .find(b => (b as HTMLElement).innerText?.trim().toLowerCase() === 'delete') as HTMLElement|undefined)?.click()
    })
  }
}

async function handleRateLimit(page: Page, state: { rateLimited: boolean }, log: LogFn): Promise<void> {
  log('⏳ Rate limited (429). Waiting 60s…')
  await sleep(60_000)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(3000)
  state.rateLimited = false
}

// ── Delete posts ──────────────────────────────────────────────────────────────

async function deletePosts(
  page: Page, profileUrl: string, tab: XOperation,
  logFile: string, state: { rateLimited: boolean }, handle: string,
  deleteLimit: number, appendMode: boolean, filters: XFilters, log: LogFn,
): Promise<number> {
  const tabUrls: Record<string, string> = {
    posts: profileUrl, replies: `${profileUrl}/with_replies`,
    media: `${profileUrl}/media`, highlights: `${profileUrl}/highlights`,
  }
  const entries = loadLog<DeletedEntry>(logFile, appendMode)
  let count = entries.length, emptyScrolls = 0, skippedStreak = 0
  let lastId: string|null = null, sameIdStreak = 0

  log(`\nNavigating to ${tab} tab…`)
  await page.goto(tabUrls[tab], { waitUntil: 'domcontentloaded', timeout: 30000 })
  try { await page.waitForSelector('[data-testid="tweet"]', { timeout: 12000 }) }
  catch { log(`No ${tab} found — skipping.`); return count - entries.length }
  log(`Starting ${tab} deletion…\n`)

  if (tab === 'media') {
    while (count < deleteLimit) {
      if (state.rateLimited) { await handleRateLimit(page, state, log); continue }
      const item = await page.$('[data-testid="cellInnerDiv"] a[href*="/status/"]')
      if (!item) {
        await page.evaluate(() => window.scrollBy(0, 500)); emptyScrolls++
        if (emptyScrolls > 9) { log('No more media.'); break }
        await sleep(3000); continue
      }
      emptyScrolls = 0
      const postUrl = await page.evaluate(el => 'https://x.com' + (el as HTMLAnchorElement).getAttribute('href'), item) as string
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      try { await page.waitForSelector('[data-testid="tweet"]', { timeout: 8000 }) }
      catch { await page.goto(tabUrls['media'], { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(2000); continue }
      const tweet = await page.$('[data-testid="tweet"]')
      if (!tweet) { await page.goto(tabUrls['media'], { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(2000); continue }
      const postText = await page.evaluate(el => (el.querySelector('[data-testid="tweetText"]') as HTMLElement|null)?.innerText?.trim() ?? '(no text)', tweet) as string
      let deleted = false
      for (let retry = 0; retry < 3; retry++) {
        try {
          const fresh = await page.$('[data-testid="tweet"]'); if (!fresh) break
          const caret = await fresh.$('[data-testid="caret"]'); if (!caret) break
          await caret.click()
          await page.waitForSelector('[role="menuitem"]', { timeout: 3000 })
          const hasDel = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).some(i => (i as HTMLElement).innerText?.trim().toLowerCase() === 'delete')) as boolean
          if (!hasDel) { await page.keyboard.press('Escape'); break }
          await page.evaluate(() => { (Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => (i as HTMLElement).innerText?.trim().toLowerCase() === 'delete') as HTMLElement|undefined)?.click() })
          await confirmDelete(page); deleted = true; break
        } catch { await page.keyboard.press('Escape'); await sleep(1000) }
      }
      if (deleted) {
        count++
        entries.push({ index: count, text: postText, tweetId: postUrl.split('/status/')?.[1], deletedAt: new Date().toISOString() })
        log(`🗑️  [${count}] "${postText.substring(0, 80)}"`)
        saveLog(logFile, entries); await sleep(1000)
      }
      await page.goto(tabUrls['media'], { waitUntil: 'domcontentloaded', timeout: 30000 })
      try { await page.waitForSelector('[data-testid="cellInnerDiv"]', { timeout: 8000 }) } catch {}
      await sleep(1000)
    }
    log('✅ media: done.')
    return count
  }

  while (count < deleteLimit) {
    if (state.rateLimited) { await handleRateLimit(page, state, log); continue }
    const tweet = await findOwnTweet(page, handle)
    if (!tweet) {
      await page.evaluate(() => window.scrollBy(0, 500)); emptyScrolls++
      if (emptyScrolls > 9) { log(`No more ${tab}.`); break }
      await sleep(3000); continue
    }
    emptyScrolls = 0
    const meta = await extractMeta(page, tweet, handle)
    const hasFilters = Object.values(filters).some(v => v !== undefined && (Array.isArray(v) ? v.length > 0 : true))
    if (hasFilters && !passesFilters(meta, filters, tab)) {
      log(`  ⏭  Skipped: "${meta.text.substring(0, 60)}"`)
      await page.evaluate(() => window.scrollBy(0, 300)); skippedStreak++
      if (skippedStreak > 40) { log('Too many consecutive skips — stopping.'); break }
      await sleep(600); continue
    }
    skippedStreak = 0

    const isRepost = await page.evaluate(el => {
      const ctx = el.querySelector('[data-testid="socialContext"]') as HTMLElement|null
      return ctx?.innerText?.toLowerCase().includes('reposted') ?? false
    }, tweet) as boolean

    if (isRepost) {
      let undone = false
      for (let retry = 0; retry < 3; retry++) {
        try {
          const fresh = await findOwnTweet(page, handle); if (!fresh) break
          const btn = await fresh.$('[data-testid="unretweet"]'); if (!btn) break
          await btn.click()
          await page.waitForSelector('[role="menuitem"]', { timeout: 3000 })
          await page.evaluate(() => { (Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[]).find(i => i.innerText?.toLowerCase().includes('undo repost'))?.click() })
          await sleep(500); undone = true; break
        } catch { await page.keyboard.press('Escape'); await sleep(1000) }
      }
      if (!undone) { await page.evaluate(() => window.scrollBy(0, 300)); await sleep(800); continue }
    } else {
      let menuOpened = false
      for (let retry = 0; retry < 3; retry++) {
        try {
          const fresh = await findOwnTweet(page, handle); if (!fresh) break
          const caret = await fresh.$('[data-testid="caret"]'); if (!caret) break
          await caret.click()
          await page.waitForSelector('[role="menuitem"]', { timeout: 3000 })
          menuOpened = true; break
        } catch { await page.keyboard.press('Escape'); await sleep(1000) }
      }
      if (!menuOpened) { await page.evaluate(() => window.scrollBy(0, 300)); await sleep(800); continue }
      const hasDel = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).some(i => (i as HTMLElement).innerText?.trim().toLowerCase() === 'delete')) as boolean
      if (!hasDel) {
        await page.keyboard.press('Escape'); await sleep(300)
        await page.evaluate(() => window.scrollBy(0, 300)); await sleep(800)
        emptyScrolls++; if (emptyScrolls > 10) { log('Too many non-deletable — stopping.'); break }
        continue
      }
      emptyScrolls = 0
      await page.evaluate(() => { (Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => (i as HTMLElement).innerText?.trim().toLowerCase() === 'delete') as HTMLElement|undefined)?.click() })
      await confirmDelete(page)
    }

    let gone = false
    try {
      await page.waitForFunction((txt: string) => !Array.from(document.querySelectorAll('[data-testid="tweetText"]')).some(el => (el as HTMLElement).innerText?.trim() === txt), { timeout: 5000 }, meta.text)
      gone = true
    } catch { log(`⚠️  Did not disappear — retrying…`); await sleep(1000) }
    if (!gone) continue

    if (meta.tweetId && meta.tweetId === lastId) {
      sameIdStreak++
      if (sameIdStreak >= 3) { log('⚠️  Same ID — reloading…'); await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(3000); sameIdStreak = 0; lastId = null; continue }
    } else sameIdStreak = 0
    lastId = meta.tweetId

    count++
    entries.push({ index: count, text: meta.text, ...(meta.tweetId ? { tweetId: meta.tweetId } : {}), ...(meta.repliedToUrl ? { repliedTo: meta.repliedToUrl } : {}), ...(meta.postedAt ? { postedAt: meta.postedAt } : {}), deletedAt: new Date().toISOString() })
    log(`🗑️  [${count}] "${meta.text.substring(0, 80)}"`)
    saveLog(logFile, entries)
  }
  log(`✅ ${tab}: done.`)
  return count
}

// ── Unlike posts ──────────────────────────────────────────────────────────────

async function unlikePosts(
  page: Page, profileUrl: string, logFile: string,
  state: { rateLimited: boolean }, deleteLimit: number, appendMode: boolean, log: LogFn,
): Promise<number> {
  const entries = loadLog<UnlikedEntry>(logFile, appendMode)
  let count = entries.length, emptyScrolls = 0
  log('\nNavigating to likes tab…')
  await page.goto(`${profileUrl}/likes`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  try { await page.waitForSelector('[data-testid="tweet"]', { timeout: 12000 }) }
  catch { log('No likes — skipping.'); return 0 }
  log('Starting unlike…\n')
  while (count < deleteLimit) {
    if (state.rateLimited) { await handleRateLimit(page, state, log); continue }
    const tweets = await page.$$('[data-testid="tweet"]')
    let tweet: ElementHandle<Element>|null = null, unlikeBtn: ElementHandle<Element>|null = null
    for (const t of tweets) {
      const btn = await t.$('[data-testid="unlike"]')
      if (btn) { tweet = t; unlikeBtn = btn; break }
    }
    if (!tweet || !unlikeBtn) {
      await page.evaluate(() => window.scrollBy(0, 500)); emptyScrolls++
      if (emptyScrolls > 9) { log('No more likes.'); break }
      await sleep(3000); continue
    }
    emptyScrolls = 0
    const text = await page.evaluate(el => (el.querySelector('[data-testid="tweetText"]') as HTMLElement|null)?.innerText?.trim() ?? '(no text)', tweet) as string
    await unlikeBtn.click()
    let unliked = false
    for (let i = 0; i < 5; i++) { await sleep(800); if (!(await tweet.$('[data-testid="unlike"]'))) { unliked = true; break } }
    if (!unliked) { log(`⚠️  Unlike failed — retrying…`); continue }
    count++
    entries.push({ index: count, text, unlikedAt: new Date().toISOString() })
    log(`💔 [${count}] "${text.substring(0, 80)}"`)
    saveLog(logFile, entries)
  }
  log('✅ likes: done.')
  return count
}

// ── Public entry ──────────────────────────────────────────────────────────────

export async function runXCleaner(opts: XCleanerOptions, log: LogFn): Promise<RunSummary> {
  const { username, deleteLimit, appendMode, operations, filters, outputDir, chromePath } = opts
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  const startTime = Date.now()
  const browser   = await launchBrowser(chromePath)
  const state     = { rateLimited: false }
  const page      = await setupPage(browser, state)

  let totalDeleted = 0
  let totalUnliked = 0

  try {
    log('\nOpening X…')
    await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(2000)

    if (!(await checkLoggedIn(page))) {
      log('Not logged in — showing overlay in browser.')
      await waitForLogin(page, log)
    }
    log('Logged in ✓')

    let profileUrl: string
    if (username?.trim()) {
      profileUrl = `https://x.com/${username.trim().replace('@', '')}`
      log(`Using provided username: @${username.trim().replace('@', '')}`)
    } else {
      log('Auto-detecting username…')
      const detected = await detectUsername(page, log)
      if (!detected) throw new Error('Could not auto-detect username.\nPlease enter it manually in the Username field.')
      log(`Detected: @${detected}`)
      profileUrl = `https://x.com/${detected}`
    }

    const handle = profileUrl.split('/').pop()!.toLowerCase()
    const out    = (name: string) => join(outputDir, name)

    if (operations.includes('posts'))      totalDeleted += await deletePosts(page, profileUrl, 'posts',      out('deleted-posts.json'),      state, handle, deleteLimit, appendMode, filters, log)
    if (operations.includes('replies'))    totalDeleted += await deletePosts(page, profileUrl, 'replies',    out('deleted-replies.json'),    state, handle, deleteLimit, appendMode, filters, log)
    if (operations.includes('unlike'))     totalUnliked += await unlikePosts(page, profileUrl,               out('unliked-posts.json'),      state, deleteLimit, appendMode, log)
    if (operations.includes('media'))      totalDeleted += await deletePosts(page, profileUrl, 'media',      out('deleted-media.json'),      state, handle, deleteLimit, appendMode, filters, log)
    if (operations.includes('highlights')) totalDeleted += await deletePosts(page, profileUrl, 'highlights', out('deleted-highlights.json'), state, handle, deleteLimit, appendMode, filters, log)

    log('\n✅ All operations complete.')
    return { success: true, totalDeleted, totalUnliked, operations, outputDir, durationMs: Date.now() - startTime }
  } catch (err: any) {
    return { success: false, totalDeleted, totalUnliked, operations, outputDir, error: err.message, durationMs: Date.now() - startTime }
  } finally {
    await browser.close()
  }
}
