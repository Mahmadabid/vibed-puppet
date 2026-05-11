// Re-export shared types so scrapers can import from one place
export type { XOperation, XFilters, RunSummary, StarResult } from '../../shared/types'

export type LogFn = (msg: string) => void

// These stay main-only (contain callbacks that can't cross IPC)
export interface XCleanerOptions {
  username?: string
  deleteLimit: number
  appendMode: boolean
  operations: import('../../shared/types').XOperation[]
  filters: import('../../shared/types').XFilters
  outputDir: string
  chromePath: string
  waitForUser: (message: string) => Promise<void>
}

export interface FormExtractorOptions {
  formUrl: string
  outputDir: string
  chromePath: string
  waitForUser: (message: string) => Promise<void>
}

export interface DeletedEntry {
  index: number
  text: string
  tweetId?: string
  repliedTo?: string
  deletedAt: string
  postedAt?: string
}

export interface UnlikedEntry {
  index: number
  text: string
  unlikedAt: string
}

export interface UnfollowedEntry {
  index: number
  handle: string
  displayName?: string
  profileUrl?: string
  unfollowedAt: string
}

export interface FormField {
  label: string
  entry: string
  type: string
  required: boolean
  description: string
  options?: string[]
  scaleMin?: string | null
  scaleMax?: string | null
}
