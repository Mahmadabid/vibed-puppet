import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, rmSync, readdirSync, readFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { runXCleaner } from './scraper/x-cleaner'
import type { RunSummary } from './scraper/x-cleaner'
import { runFormsExtractor } from './scraper/forms-extractor'
import { runGitHubStar } from './scraper/github-star'
import { initUpdater, checkForUpdates, checkForUpdatesManual } from './scraper/updater'
import type { XCleanerOptions, FormExtractorOptions } from './scraper/types'

let mainWindow: BrowserWindow | null = null

// ── Default paths ─────────────────────────────────────────────────────────────

function defaultChromePath() { return join(app.getPath('userData'), 'chrome-profile') }
function defaultOutputPath()  { return join(app.getPath('documents'), 'vibed-puppet-output') }

// ── Window ────────────────────────────────────────────────────────────────────

function getIcon() {
  // In production, look for resources/icon.png bundled with the app
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.png'),
    join(__dirname, '../../../resources/icon.png'),
    join(__dirname, '../../../logo.svg'),  // fallback for dev (SVG not supported on Windows for taskbar)
  ]
  for (const p of candidates) {
    if (existsSync(p) && !p.endsWith('.svg')) {
      return nativeImage.createFromPath(p)
    }
  }
  return undefined
}

function createWindow(): void {
  const icon = getIcon()

  mainWindow = new BrowserWindow({
    width: 1140, height: 760,
    minWidth: 860, minHeight: 580,
    backgroundColor: '#161b27',
    frame: false, icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    // Set taskbar icon explicitly on Windows
    if (process.platform === 'win32' && icon) {
      mainWindow!.setIcon(icon)
    }
    initUpdater(mainWindow!)
    checkForUpdates()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vibedpuppet.app')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
  createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendLog(msg: string): void {
  // Detect forms-done signal and emit a separate event
  if (msg.includes('__FORMS_DONE__:')) {
    const outputFile = msg.split('__FORMS_DONE__:')[1]?.trim()
    if (outputFile) mainWindow?.webContents.send('forms-done', outputFile)
  }
  mainWindow?.webContents.send('log', msg)
}
function sendStatus(s: 'idle'|'running'|'done'|'error')   { mainWindow?.webContents.send('status', s) }
function sendSummary(summary: RunSummary)                  { mainWindow?.webContents.send('run-summary', summary) }

let running = false

// ── Window controls ───────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())
ipcMain.on('window-close',    () => mainWindow?.close())

// ── Paths ─────────────────────────────────────────────────────────────────────

ipcMain.handle('get-default-paths', () => ({
  chromePath: defaultChromePath(),
  outputPath: defaultOutputPath(),
}))

// ── Dialogs ───────────────────────────────────────────────────────────────────

ipcMain.handle('open-file-dialog', async (_, opts: Electron.OpenDialogOptions) => {
  if (!mainWindow) return { canceled: true, filePaths: [] }
  return dialog.showOpenDialog(mainWindow, opts)
})

ipcMain.handle('open-folder', async (_, folderPath: string) => {
  if (!existsSync(folderPath)) mkdirSync(folderPath, { recursive: true })
  shell.openPath(folderPath)
})

ipcMain.handle('open-url', async (_, url: string) => {
  shell.openExternal(url)
})

// ── X Cleaner ─────────────────────────────────────────────────────────────────

ipcMain.handle('run-x-cleaner', async (_, opts: XCleanerOptions) => {
  if (running) return { error: 'Already running.' }
  running = true
  sendStatus('running')

  if (!existsSync(opts.outputDir)) mkdirSync(opts.outputDir, { recursive: true })

  try {
    const summary = await runXCleaner(opts, sendLog)
    sendSummary(summary)
    sendStatus(summary.success ? 'done' : 'error')
    if (!summary.success && summary.error) sendLog(`\n❌ ${summary.error}\n`)
  } catch (err: any) {
    sendLog(`\n❌ ${err.message}\n`)
    sendStatus('error')
    sendSummary({ success: false, totalDeleted: 0, totalUnliked: 0, totalUnfollowed: 0, operations: [], outputDir: opts.outputDir, error: err.message, durationMs: 0 })
  } finally { running = false }

  return { ok: true }
})

// ── Forms extractor ───────────────────────────────────────────────────────────

ipcMain.handle('run-forms-extractor', async (_, opts: FormExtractorOptions) => {
  if (running) return { error: 'Already running.' }
  running = true
  sendStatus('running')
  if (!existsSync(opts.outputDir)) mkdirSync(opts.outputDir, { recursive: true })

  // Remove waitSeconds if passed from old renderer versions
  const cleanOpts = { formUrl: opts.formUrl, outputDir: opts.outputDir, chromePath: opts.chromePath }
  const withCallbacks: FormExtractorOptions = {
    ...cleanOpts,
    waitForUser: (msg: string) => new Promise(resolve => {
      sendLog(`\n⏸  ${msg}\n`)
      mainWindow?.webContents.send('wait-for-user', msg)
      ipcMain.once('user-continued', () => resolve())
    }),
  }
  try {
    await runFormsExtractor(withCallbacks, sendLog)
    sendStatus('done')
  } catch (err: any) {
    sendLog(`\n❌ ${err.message}\n`)
    sendStatus('error')
  } finally { running = false }
  return { ok: true }
})

// ── GitHub Star ───────────────────────────────────────────────────────────────

ipcMain.handle('github-star', async (_, chromePath: string) => {
  if (running) return { error: 'A scraper is already running.' }
  running = true
  sendStatus('running')
  try {
    const result = await runGitHubStar(chromePath, sendLog)
    sendStatus(result.success ? 'done' : 'error')
    mainWindow?.webContents.send('star-result', result)
    return result
  } finally { running = false }
})

// ── User continued ────────────────────────────────────────────────────────────

ipcMain.handle('user-continued', async () => { ipcMain.emit('user-continued'); return { ok: true } })

// ── Stop ──────────────────────────────────────────────────────────────────────

ipcMain.handle('stop', async () => {
  running = false; sendStatus('idle'); sendLog('\n⛔  Stopped by user.\n'); return { ok: true }
})

// ── Reset profile ─────────────────────────────────────────────────────────────

ipcMain.handle('reset-profile', async (_, profilePath: string) => {
  try {
    if (!existsSync(profilePath)) return { ok: true, message: 'Profile not found — nothing to delete.' }
    rmSync(profilePath, { recursive: true, force: true })
    return { ok: true, message: `Deleted: ${profilePath}` }
  } catch (e: any) { return { error: e.message } }
})

// ── Read output ───────────────────────────────────────────────────────────────

ipcMain.handle('read-output', async (_, outputDir: string) => {
  try {
    if (!existsSync(outputDir)) return { files: {} }
    const files: Record<string, unknown[]> = {}
    for (const file of readdirSync(outputDir).filter(f => f.endsWith('.json'))) {
      try { files[file] = JSON.parse(readFileSync(join(outputDir, file), 'utf-8')) } catch {}
    }
    return { files }
  } catch (e: any) { return { error: e.message } }
})

// ── Updater ───────────────────────────────────────────────────────────────────

ipcMain.handle('check-for-updates', async () => { checkForUpdatesManual(); return { ok: true } })
ipcMain.handle('get-version', async () => app.getVersion())
