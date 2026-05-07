import puppeteer from 'puppeteer-core'
import { join } from 'path'
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { findChrome, sleep } from './utils'
import { injectOverlay, removeOverlay, pollOverlayResult } from './browser-ui'
import type { LogFn, FormExtractorOptions, FormField } from './types'

const TYPE_MAP: Record<number, string> = {
  0: 'Short answer', 1: 'Paragraph',      2: 'Multiple choice',
  3: 'Dropdown',     4: 'Checkboxes',     5: 'Linear scale',
  7: 'Grid',         8: 'Date',           9: 'Time',
  10: 'File upload',
}

const WAIT_SECONDS = 60 // max seconds to poll for form data after navigation

async function hasFormData(page: puppeteer.Page): Promise<boolean> {
  return page.evaluate(
    () => typeof (window as any).FB_PUBLIC_LOAD_DATA_ !== 'undefined' &&
          Array.isArray((window as any).FB_PUBLIC_LOAD_DATA_?.[1]?.[1])
  ) as Promise<boolean>
}

async function extractFields(page: puppeteer.Page): Promise<FormField[]> {
  return page.evaluate((typeMap: Record<string, string>) => {
    const data      = (window as any).FB_PUBLIC_LOAD_DATA_
    const questions = data?.[1]?.[1]
    if (!Array.isArray(questions)) return []
    return questions
      .filter((q: any) => Array.isArray(q) && q[4]?.[0]?.[0] !== undefined)
      .map((q: any) => {
        const entryBlock = q[4][0]
        const typeNum    = q[3]
        const field: any = {
          label:       q[1] ?? '',
          entry:       `entry.${entryBlock[0]}`,
          type:        typeMap[String(typeNum)] ?? `Unknown (${typeNum})`,
          required:    entryBlock[2] === 1,
          description: q[2] ?? '',
        }
        if (Array.isArray(entryBlock[1]))
          field.options = entryBlock[1].map((o: any) => o[0])
        if (typeNum === 5 && Array.isArray(entryBlock[3])) {
          field.scaleMin = entryBlock[3][0] ?? null
          field.scaleMax = entryBlock[3][1] ?? null
        }
        return field
      })
  }, TYPE_MAP) as Promise<FormField[]>
}

/** Wait for form data to appear, polling every 500ms up to WAIT_SECONDS */
async function waitForFormData(page: puppeteer.Page, log: LogFn): Promise<boolean> {
  log(`Waiting for form data (up to ${WAIT_SECONDS}s)…`)
  const deadline = Date.now() + WAIT_SECONDS * 1000
  let dots = 0

  // Show a silent loading overlay
  await injectOverlay(page, {
    message: 'Loading form data…',
    buttons: [],
    loading: true,
  })

  while (Date.now() < deadline) {
    if (await hasFormData(page)) {
      await removeOverlay(page)
      return true
    }
    await sleep(500)
    dots++
    if (dots % 10 === 0) {
      const rem = Math.ceil((deadline - Date.now()) / 1000)
      log(`  Still waiting… ${rem}s remaining`)
    }
  }
  await removeOverlay(page)
  return false
}

/** Show login overlay and wait until user clicks Done or Cancel */
async function waitForLogin(page: puppeteer.Page, log: LogFn): Promise<boolean> {
  let attempt = 0
  while (true) {
    attempt++
    log(`  Showing sign-in overlay (attempt ${attempt})…`)

    await injectOverlay(page, {
      message: attempt === 1
        ? 'Sign in to your Google account,\nthen click <strong>Done</strong> once the form is visible.'
        : `Still waiting… (attempt ${attempt})\nClick <strong>Done</strong> once you see the form.`,
      buttons: [
        { label: 'Done', action: 'continue', primary: true },
        { label: 'Cancel', action: 'cancel' },
      ],
    })

    const deadline = Date.now() + (attempt === 1 ? 10 * 60 * 1000 : 2 * 60 * 1000)
    while (Date.now() < deadline) {
      await sleep(1000)

      const result = await pollOverlayResult(page).catch(() => null)
      if (result === 'cancel') { log('Cancelled by user.'); return false }
      if (result === 'continue') {
        await sleep(1500)
        if (await hasFormData(page)) { await removeOverlay(page); return true }
        // Maybe form needs a moment to load after login
        const found = await waitForFormData(page, log)
        if (found) return true
        log('  Form data not found after login click — re-showing overlay.')
        break
      }

      // Auto-detect: re-inject overlay if it disappeared due to navigation
      const hasOverlay = await page.evaluate(() => !!document.getElementById('__vp_overlay__')).catch(() => false)
      if (!hasOverlay) {
        await injectOverlay(page, {
          message: `Sign in completed? Click <strong>Done</strong> once the form is visible.\n<small>(attempt ${attempt})</small>`,
          buttons: [
            { label: 'Done', action: 'continue', primary: true },
            { label: 'Cancel', action: 'cancel' },
          ],
        }).catch(() => {})
      }
    }
  }
}

export async function runFormsExtractor(opts: FormExtractorOptions, log: LogFn): Promise<void> {
  const { formUrl, outputDir, chromePath } = opts
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  const executablePath = findChrome()
  if (!executablePath) throw new Error('Chrome not found. Install Google Chrome and retry.')

  log('\nLaunching browser…')
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
    log('Navigating to form URL…')
    await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(1500)

    // ── Fast path: form data already available (logged in + public form) ──────
    if (await hasFormData(page)) {
      log('Form data ready — extracting automatically.')
      // No confirmation needed — just extract
    } else {
      // ── Check if this is a sign-in page ─────────────────────────────────────
      const isLoginPage = await page.evaluate(
        () => document.title.toLowerCase().includes('sign in') ||
              !!document.querySelector('input[type="email"]') ||
              window.location.hostname.includes('accounts.google')
      )

      if (isLoginPage) {
        log('Google sign-in required.')
        const ok = await waitForLogin(page, log)
        if (!ok) return

        // After login, reload the form URL in case we navigated away
        if (!(await hasFormData(page))) {
          log('Reloading form URL after sign-in…')
          await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
          await sleep(1500)
        }
      } else {
        // Form loaded but data not yet available — wait silently
        log('Form loaded, waiting for data…')
        const found = await waitForFormData(page, log)

        if (!found) {
          // Last attempt: reload
          log('Still not found — reloading form URL…')
          await page.goto(formUrl, { waitUntil: 'networkidle2', timeout: 60000 })
          await sleep(2000)

          if (!(await hasFormData(page))) {
            throw new Error(
              `Form data (FB_PUBLIC_LOAD_DATA_) not found after ${WAIT_SECONDS}s.\n` +
              'Make sure the URL is a public Google Form and fully loaded.'
            )
          }
          log('Form data found after reload.')
        }
      }
    }

    // ── Extract ──────────────────────────────────────────────────────────────
    await injectOverlay(page, { message: 'Extracting fields…', buttons: [], loading: true })
    log('Extracting fields…')

    const fields = await extractFields(page)
    const outputFile = join(outputDir, 'form-fields.json')
    writeFileSync(outputFile, JSON.stringify(fields, null, 2), 'utf-8')

    await removeOverlay(page)

    // Build result summary for overlay (using text-safe format)
    const summaryLines = fields.slice(0, 12).map(f => {
      const req  = f.required ? '[req]' : '[opt]'
      const opts = f.options?.length
        ? ` (${f.options.slice(0, 2).join(', ')}${f.options.length > 2 ? '…' : ''})`
        : ''
      return `${req} ${f.entry} — ${f.label.substring(0, 32)}${opts}`
    }).join('\n') + (fields.length > 12 ? `\n…and ${fields.length - 12} more` : '')

    await injectOverlay(page, {
      message: `Extracted ${fields.length} field${fields.length !== 1 ? 's' : ''} successfully.\n\n${summaryLines}\n\nSaved to: ${outputFile}`,
      buttons: [{ label: 'Close', action: 'close', primary: true }],
    })

    log(`\n✅ Extracted ${fields.length} field(s) → ${outputFile}`)
    for (const f of fields) {
      const req  = f.required ? '★' : '○'
      const opts = f.options?.length
        ? ` [${f.options.slice(0, 3).join(', ')}${f.options.length > 3 ? '…' : ''}]`
        : ''
      log(`  ${req} ${f.entry}  ${f.type}  "${f.label}"${opts}`)
    }

    // Signal to renderer that we're done with the file path
    log(`\n__FORMS_DONE__:${outputFile}`)

    // Wait for user to close overlay (max 3 min)
    const closeDeadline = Date.now() + 3 * 60 * 1000
    while (Date.now() < closeDeadline) {
      await sleep(500)
      const r = await pollOverlayResult(page).catch(() => null)
      if (r) break
    }

  } finally {
    await browser.close()
  }
}
