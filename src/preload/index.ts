import { contextBridge, ipcRenderer } from 'electron'

const api = {
  runXCleaner:       (opts: object) => ipcRenderer.invoke('run-x-cleaner', opts),
  runFormsExtractor: (opts: object) => ipcRenderer.invoke('run-forms-extractor', opts),
  githubStar:        (chromePath: string) => ipcRenderer.invoke('github-star', chromePath),
  userContinued:     () => ipcRenderer.invoke('user-continued'),
  stop:              () => ipcRenderer.invoke('stop'),
  getDefaultPaths:   (): Promise<{ chromePath: string; outputPath: string }> => ipcRenderer.invoke('get-default-paths'),
  openFileDialog:    (opts: object) => ipcRenderer.invoke('open-file-dialog', opts),
  openFolder:        (path: string) => ipcRenderer.invoke('open-folder', path),
  openUrl:           (url: string)  => ipcRenderer.invoke('open-url', url),
  resetProfile:      (path: string) => ipcRenderer.invoke('reset-profile', path),
  readOutput:        (dir: string)  => ipcRenderer.invoke('read-output', dir),
  checkForUpdates:   ()             => ipcRenderer.invoke('check-for-updates'),
  getVersion:        ()             => ipcRenderer.invoke('get-version') as Promise<string>,
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose:    () => ipcRenderer.send('window-close'),
  onLog:          (cb: (msg: string) => void)    => sub('log', cb),
  onStatus:       (cb: (s: string) => void)      => sub('status', cb),
  onWaitForUser:  (cb: (msg: string) => void)    => sub('wait-for-user', cb),
  onUpdateStatus: (cb: (d: unknown) => void)     => sub('update-status', cb),
  onRunSummary:   (cb: (d: unknown) => void)     => sub('run-summary', cb),
  onStarResult:   (cb: (d: unknown) => void)     => sub('star-result', cb),
  onFormsDone:    (cb: (path: string) => void)  => sub('forms-done',   cb),
}

function sub(channel: string, cb: (v: any) => void) {
  const h = (_: unknown, v: any) => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

if (process.contextIsolated) {
  try { contextBridge.exposeInMainWorld('api', api) } catch (e) { console.error(e) }
} else { (window as any).api = api }

export type CullAPI = typeof api
