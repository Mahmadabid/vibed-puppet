/// <reference types="vite/client" />

// All types come from shared/ — no main process imports allowed in renderer
import type { XFilters, XOperation, RunSummary, StarResult, UpdateStatus } from '../../shared/types'

export type { XFilters, XOperation, RunSummary, StarResult, UpdateStatus }

interface CullAPI {
  runXCleaner:       (opts: {
    username?: string; deleteLimit: number; appendMode: boolean
    operations: XOperation[]; filters: XFilters
    outputDir: string; chromePath: string
  }) => Promise<{ ok?: boolean; error?: string }>

  runFormsExtractor: (opts: {
    formUrl: string; outputDir: string; chromePath: string
  }) => Promise<{ ok?: boolean; error?: string }>

  githubStar:      (chromePath: string) => Promise<StarResult>
  userContinued:   () => Promise<{ ok: boolean }>
  stop:            () => Promise<{ ok: boolean }>
  getDefaultPaths: () => Promise<{ chromePath: string; outputPath: string }>

  openFileDialog: (opts: {
    properties: string[]
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<{ canceled: boolean; filePaths: string[] }>

  openFolder:      (path: string) => Promise<void>
  openUrl:         (url: string)  => Promise<void>
  resetProfile:    (path: string) => Promise<{ ok?: boolean; error?: string; message?: string }>
  readOutput:      (dir: string)  => Promise<{ files?: Record<string, unknown[]>; error?: string }>
  checkForUpdates: ()             => Promise<{ ok: boolean }>
  getVersion:      ()             => Promise<string>

  windowMinimize: () => void
  windowMaximize: () => void
  windowClose:    () => void

  onLog:          (cb: (msg: string)        => void) => () => void
  onStatus:       (cb: (status: string)     => void) => () => void
  onWaitForUser:  (cb: (msg: string)        => void) => () => void
  onUpdateStatus: (cb: (data: UpdateStatus) => void) => () => void
  onRunSummary:   (cb: (data: RunSummary)   => void) => () => void
  onStarResult:   (cb: (data: StarResult)   => void) => () => void
}

declare global {
  interface Window { api: CullAPI }
}
