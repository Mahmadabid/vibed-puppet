import { autoUpdater } from 'electron-updater'
import { BrowserWindow, dialog, app } from 'electron'
import log from 'electron-log'

autoUpdater.logger = log
;(autoUpdater.logger as any).transports.file.level = 'info'
autoUpdater.autoDownload = false    // ask user first
autoUpdater.autoInstallOnAppQuit = true

let mainWindow: BrowserWindow | null = null

function send(event: string, data?: unknown) {
  mainWindow?.webContents.send(event, data)
}

export function initUpdater(win: BrowserWindow): void {
  mainWindow = win

  autoUpdater.on('checking-for-update', () => {
    send('update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', info => {
    send('update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes })
    // Show native dialog so the user can choose to download
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update available',
      message: `Vibed Puppet ${info.version} is available.`,
      detail: 'Would you like to download it now? The app will restart automatically after install.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate()
    })
  })

  autoUpdater.on('update-not-available', () => {
    send('update-status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', progress => {
    send('update-status', {
      status:   'downloading',
      percent:  Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
    })
    win.setProgressBar(progress.percent / 100)
  })

  autoUpdater.on('update-downloaded', info => {
    win.setProgressBar(-1)
    send('update-status', { status: 'ready', version: info.version })
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready',
      message: `Vibed Puppet ${info.version} downloaded.`,
      detail: 'Restart now to apply the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true)
      }
    })
  })

  autoUpdater.on('error', (err: Error) => {
    win.setProgressBar(-1)
    send('update-status', { status: 'error', message: err.message })
    log.error('Updater error:', err)
  })
}

/** Call this on app ready — checks silently in background */
export function checkForUpdates(): void {
  // Only run in production (packaged) builds
  if (!app.isPackaged) return
  // Give the window a moment to render before showing dialogs
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000)
}

/** Exposed to renderer via IPC to let the user trigger a manual check */
export function checkForUpdatesManual(): void {
  autoUpdater.checkForUpdates().catch(err => {
    log.error('Manual update check failed:', err)
  })
}
