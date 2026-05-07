import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export function findChrome(): string | undefined {
  const candidates: string[] = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]
  return candidates.find(p => existsSync(p))
}

export function loadLog<T>(file: string, appendMode: boolean): T[] {
  if (appendMode && existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf-8')) as T[] } catch {}
  }
  return []
}

export function saveLog<T>(file: string, data: T[]): void {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}
