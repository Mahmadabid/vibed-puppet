// Shared types — imported by both main process and renderer.
// Must contain NO Node.js imports.

export type XOperation = 'posts' | 'replies' | 'unlike' | 'unfollow' | 'media' | 'highlights'

export interface XFilters {
  dateFrom?: string
  dateTo?: string
  keywords?: string[]
  replyToPostUrl?: string
  replyToUser?: string
  maxLikes?: number
  maxReplies?: number
  skipPinned?: boolean
}

export interface RunSummary {
  success: boolean
  totalDeleted: number
  totalUnliked: number
  totalUnfollowed: number
  operations: string[]
  outputDir: string
  error?: string
  durationMs: number
}

export interface StarResult {
  success: boolean
  alreadyStarred?: boolean
  error?: string
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
  message?: string
}
