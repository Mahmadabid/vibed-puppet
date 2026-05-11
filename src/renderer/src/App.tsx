import { useState, useEffect, useRef, useCallback, Component } from 'react'
import type { ReactNode } from 'react'
import {
  Trash2, MessageSquare, Heart, Image, Star, Zap,
  FileJson, FolderOpen, Square, ChevronDown, ChevronUp,
  RefreshCw, ExternalLink, Minus, Maximize2, X,
  Terminal, Settings, RotateCcw, Play, AlertCircle,
  CheckSquare, SlidersHorizontal, Calendar, Type,
  ArrowRight, Download, Info, Sun, Moon, Copy, Check,
  CheckCircle, CircleX, Clock, Eye, UserMinus,
} from 'lucide-react'
import type { XFilters, XOperation, RunSummary } from '../../shared/types'

type Tab    = 'cleaner' | 'forms' | 'results' | 'settings'
type Status = 'idle' | 'running' | 'done' | 'error'
type Theme  = 'dark' | 'light'

// ── Error boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e: Error) { return { error: e.message + '\n' + e.stack } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 24, fontFamily: 'monospace', color: '#ff5577', background: '#0d0d14', height: '100vh', boxSizing: 'border-box' }}>
        <b style={{ fontSize: 14 }}>Render error</b>
        <pre style={{ fontSize: 11, marginTop: 12, whiteSpace: 'pre-wrap', opacity: 0.8 }}>{this.state.error}</pre>
      </div>
    )
    return this.props.children
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('vp-theme') as Theme) ?? 'dark' } catch { return 'dark' }
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('vp-theme', theme) } catch {}
  }, [theme])
  return [theme, useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])]
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function VPLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <rect width="256" height="256" rx="40" fill="#0f172a"/>
      <g stroke="#00ffa6" strokeWidth="14" strokeLinecap="round">
        <line x1="40" y1="80"  x2="216" y2="80"/>
        <line x1="40" y1="128" x2="216" y2="128"/>
        <line x1="40" y1="176" x2="216" y2="176"/>
      </g>
      <circle cx="80"  cy="80"  r="14" fill="#00ffa6"/>
      <circle cx="140" cy="128" r="14" fill="#00ffa6"/>
      <circle cx="200" cy="176" r="14" fill="#00ffa6"/>
    </svg>
  )
}
function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" width={size} height={size}>
      <path fillRule="evenodd" clipRule="evenodd" d="M12.026 2c-5.509 0-9.974 4.465-9.974 9.974 0 4.406 2.857 8.145 6.821 9.465.499.09.679-.217.679-.481 0-.237-.008-.865-.011-1.696-2.775.602-3.361-1.338-3.361-1.338-.452-1.152-1.107-1.459-1.107-1.459-.905-.619.069-.605.069-.605 1.002.07 1.527 1.028 1.527 1.028.89 1.524 2.336 1.084 2.902.829.091-.645.351-1.085.635-1.334-2.214-.251-4.542-1.107-4.542-4.93 0-1.087.389-1.979 1.024-2.675-.101-.253-.446-1.268.099-2.64 0 0 .837-.269 2.742 1.021a9.582 9.582 0 0 1 2.496-.336 9.554 9.554 0 0 1 2.496.336c1.906-1.291 2.742-1.021 2.742-1.021.545 1.372.203 2.387.099 2.64.64.696 1.024 1.587 1.024 2.675 0 3.833-2.33 4.675-4.552 4.922.355.308.675.916.675 1.846 0 1.334-.012 2.41-.012 2.737 0 .267.178.577.687.479C19.146 20.115 22 16.379 22 11.974 22 6.465 17.535 2 12.026 2z" />
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function pickDir() {
  const res = await window.api.openFileDialog({ properties: ['openDirectory'] })
  return res.canceled ? null : res.filePaths[0] ?? null
}
function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: Status }) {
  const col: Record<Status, string> = { idle: 'var(--color-muted)', running: 'var(--color-warn)', done: 'var(--color-success)', error: 'var(--color-danger)' }
  const lbl: Record<Status, string> = { idle: 'Ready', running: 'Running…', done: 'Done', error: 'Error' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: col[status], flexShrink: 0, transition: 'background .3s' }} className={status === 'running' ? 'pulse' : ''} />
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-muted-light)' }}>{lbl[status]}</span>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><div className="label">{label}</div>{children}</div>
}

function PathPicker({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <FieldRow label={label}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="field" style={{ flex: 1 }} value={value} onChange={e => onChange(e.target.value)} placeholder="C:\path\to\folder" />
        <button className="btn btn-ghost" style={{ padding: '0 10px' }} onClick={async () => { const p = await pickDir(); if (p) onChange(p) }}>
          <FolderOpen size={13} />
        </button>
      </div>
      {hint && <p style={{ margin: 0, fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{hint}</p>}
    </FieldRow>
  )
}

// ── Summary modal ─────────────────────────────────────────────────────────────
function SummaryModal({ summary, onClose }: { summary: RunSummary; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 14, padding: '28px 32px', minWidth: 380, maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()} className="animate-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          {summary.success
            ? <CheckCircle size={28} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
            : <CircleX size={28} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />}
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: summary.success ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {summary.success ? 'Completed successfully' : 'Finished with error'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-muted-light)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={11} /> Took {formatDuration(summary.durationMs)}
            </div>
          </div>
        </div>
        {summary.error && (
          <div style={{ background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger) 25%, transparent)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: 'var(--color-danger)', lineHeight: 1.5 }}>
            {summary.error}
          </div>
        )}
        {(summary.totalDeleted > 0 || summary.totalUnliked > 0 || summary.totalUnfollowed > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
            {summary.totalDeleted > 0 && (
              <div style={{ background: 'var(--color-panel-alt)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-danger)', fontFamily: 'var(--font-mono)' }}>{summary.totalDeleted}</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 3 }}>items deleted</div>
              </div>
            )}
            {summary.totalUnliked > 0 && (
              <div style={{ background: 'var(--color-panel-alt)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>{summary.totalUnliked}</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 3 }}>posts unliked</div>
              </div>
            )}
            {summary.totalUnfollowed > 0 && (
              <div style={{ background: 'var(--color-panel-alt)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-warn)', fontFamily: 'var(--font-mono)' }}>{summary.totalUnfollowed}</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 3 }}>accounts unfollowed</div>
              </div>
            )}
          </div>
        )}
        {summary.operations.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="label" style={{ marginBottom: 6 }}>Operations</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {summary.operations.map(op => <span key={op} className="pill" style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}>{op}</span>)}
            </div>
          </div>
        )}
        <div style={{ marginBottom: 20, padding: '10px 12px', background: 'var(--color-panel-alt)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>Output saved to</div>
          <div style={{ fontSize: 12, color: 'var(--color-text)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{summary.outputDir}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-accent" style={{ flex: 1 }} onClick={() => { window.api.openFolder(summary.outputDir); onClose() }}>
            <FolderOpen size={13} /> Open output folder
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Forms Result Modal ────────────────────────────────────────────────────────
interface FormField { label: string; entry: string; type: string; required: boolean; description?: string; options?: string[] }

function FormsResultModal({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  const [fields, setFields]   = useState<FormField[]>([])
  const [copied, setCopied]   = useState(false)
  const [error,  setError]    = useState('')

  useEffect(() => {
    window.api.readOutput(filePath.replace(/[^\\/]+$/, '')).then(res => {
      const fname = filePath.split(/[\\/]/).pop() ?? 'form-fields.json'
      const data = res.files?.[fname] as FormField[] | undefined
      if (data) setFields(data)
      else setError('Could not read form-fields.json')
    }).catch(e => setError(String(e)))
  }, [filePath])

  const jsonText = JSON.stringify(fields, null, 2)

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(jsonText); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 14, width: 660, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()} className="animate-in">
        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Extracted Form Fields</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{filePath}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={copyAll}>
              {copied ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
            <button className="btn btn-ghost" style={{ padding: '0 8px' }} onClick={onClose}><X size={13} /></button>
          </div>
        </div>

        {error && <p style={{ margin: 16, color: 'var(--color-danger)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{error}</p>}

        {/* Fields table */}
        {fields.length > 0 && (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table className="data-table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th>Entry ID</th><th>Label</th><th>Type</th><th>Req</th><th>Options</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => navigator.clipboard.writeText(f.entry)}
                        title="Copy entry ID"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {f.entry} <Copy size={10} style={{ opacity: 0.5 }} />
                      </button>
                    </td>
                    <td title={f.label}>{f.label.substring(0, 36)}{f.label.length > 36 ? '…' : ''}</td>
                    <td style={{ color: 'var(--color-muted-light)', whiteSpace: 'nowrap' }}>{f.type}</td>
                    <td style={{ textAlign: 'center' }}>{f.required ? <span style={{ color: 'var(--color-accent)' }}>★</span> : <span style={{ color: 'var(--color-muted)' }}>○</span>}</td>
                    <td style={{ color: 'var(--color-muted)', fontSize: 11 }}>
                      {f.options?.slice(0, 3).join(', ')}{(f.options?.length ?? 0) > 3 ? '…' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* JSON view */}
        <div style={{ borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
          <details style={{ padding: '0' }}>
            <summary style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 12, color: 'var(--color-muted-light)', fontFamily: 'var(--font-mono)', listStyle: 'none', userSelect: 'none' }}>
              View raw JSON ▸
            </summary>
            <pre style={{ margin: 0, padding: '12px 16px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text)', background: 'var(--color-bg)', maxHeight: 220, overflow: 'auto', WebkitUserSelect: 'text', userSelect: 'text' }}>
              {jsonText}
            </pre>
          </details>
        </div>
      </div>
    </div>
  )
}

// ── Operations ────────────────────────────────────────────────────────────────
const OPS: { id: XOperation; label: string; icon: ReactNode }[] = [
  { id: 'posts',      label: 'Posts & reposts', icon: <Trash2 size={12} /> },
  { id: 'replies',    label: 'Replies',          icon: <MessageSquare size={12} /> },
  { id: 'unlike',     label: 'Unlike all',       icon: <Heart size={12} /> },
  { id: 'unfollow',   label: 'Unfollow',         icon: <UserMinus size={12} /> },
  { id: 'media',      label: 'Media tab',        icon: <Image size={12} /> },
  { id: 'highlights', label: 'Highlights',       icon: <Star size={12} /> },
]

// ── Filter panel ──────────────────────────────────────────────────────────────
function FilterPanel({ filters, onChange }: { filters: XFilters; onChange: (f: XFilters) => void }) {
  const [open, setOpen] = useState(false)
  const set = (p: Partial<XFilters>) => onChange({ ...filters, ...p })
  const count = [filters.dateFrom, filters.dateTo, filters.keywords?.length, filters.replyToPostUrl, filters.replyToUser, filters.maxLikes !== undefined, filters.maxReplies !== undefined, filters.skipPinned].filter(Boolean).length

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: open ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SlidersHorizontal size={13} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 500 }}>Advanced filters</span>
          {count > 0 && <span className="pill" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>{count} active</span>}
        </div>
        {open ? <ChevronUp size={13} style={{ color: 'var(--color-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--color-muted)' }} />}
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--color-border)' }} className="animate-in">
          {/* Date range */}
          <div style={{ paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Calendar size={12} style={{ color: 'var(--color-accent)' }} />
              <span className="label" style={{ marginBottom: 0 }}>Date range</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
              <input type="date" className="field" value={filters.dateFrom ?? ''} onChange={e => set({ dateFrom: e.target.value || undefined })} />
              <ArrowRight size={12} style={{ color: 'var(--color-muted)' }} />
              <input type="date" className="field" value={filters.dateTo ?? ''} onChange={e => set({ dateTo: e.target.value || undefined })} />
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>Only delete posts within this date range. Leave blank to delete all.</p>
          </div>

          {/* Keywords */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Type size={12} style={{ color: 'var(--color-accent)' }} />
              <span className="label" style={{ marginBottom: 0 }}>Keyword filter</span>
            </div>
            <input className="field" placeholder="e.g. crypto, giveaway — only delete posts containing ALL these words"
              value={filters.keywords?.join(', ') ?? ''}
              onChange={e => { const kws = e.target.value.split(',').map(s => s.trim()).filter(Boolean); set({ keywords: kws.length ? kws : undefined }) }} />
            <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>Post must contain every listed word (case-insensitive).</p>
          </div>

          {/* Reply targets */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <MessageSquare size={12} style={{ color: 'var(--color-accent)' }} />
              <span className="label" style={{ marginBottom: 0 }}>Reply target — only applies to the Replies operation</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input className="field" placeholder="@handle — delete only replies directed at this person"
                value={filters.replyToUser ?? ''} onChange={e => set({ replyToUser: e.target.value || undefined })} />
              <input className="field" placeholder="https://x.com/user/status/… — delete only replies under this specific post"
                value={filters.replyToPostUrl ?? ''} onChange={e => set({ replyToPostUrl: e.target.value || undefined })} />
            </div>
          </div>

          {/* Engagement ceiling */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <AlertCircle size={12} style={{ color: 'var(--color-accent)' }} />
              <span className="label" style={{ marginBottom: 0 }}>Engagement ceiling — skip post if at or above</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <FieldRow label="Likes ≥"><input type="number" min="0" className="field" placeholder="∞ (no limit)" value={filters.maxLikes ?? ''} onChange={e => set({ maxLikes: e.target.value ? Number(e.target.value) : undefined })} /></FieldRow>
              <FieldRow label="Replies ≥"><input type="number" min="0" className="field" placeholder="∞ (no limit)" value={filters.maxReplies ?? ''} onChange={e => set({ maxReplies: e.target.value ? Number(e.target.value) : undefined })} /></FieldRow>
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>Protects posts that got meaningful engagement from being deleted.</p>
          </div>

          <label className="check-row">
            <input type="checkbox" checked={filters.skipPinned ?? false} onChange={e => set({ skipPinned: e.target.checked || undefined })} />
            <span style={{ fontSize: 12 }}>Skip pinned post</span>
          </label>

          <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11 }} onClick={() => onChange({})}>
            Clear all filters
          </button>
        </div>
      )}
    </div>
  )
}

// ── X Cleaner tab ─────────────────────────────────────────────────────────────
function XCleanerTab({ isRunning, onRun, onStop, defaultChromePath, defaultOutputPath }: {
  isRunning: boolean; onRun: (opts: any) => void; onStop: () => void
  defaultChromePath: string; defaultOutputPath: string
}) {
  const [outputDir,  setOutputDir]  = useState('')
  const [chromePath, setChromePath] = useState('')
  const [username,   setUsername]   = useState('')
  const [limit,      setLimit]      = useState('Infinity')
  const [appendMode, setAppendMode] = useState(true)
  const [selected,   setSelected]   = useState<Set<XOperation>>(new Set(['posts']))
  const [allOps,     setAllOps]     = useState(false)
  const [filters,    setFilters]    = useState<XFilters>({})

  useEffect(() => { if (defaultOutputPath && !outputDir) setOutputDir(defaultOutputPath) }, [defaultOutputPath])
  useEffect(() => { if (defaultChromePath && !chromePath) setChromePath(defaultChromePath) }, [defaultChromePath])

  const toggleOp = (id: XOperation) => { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); setAllOps(n.size === OPS.length); return n }) }
  const toggleAll = () => { if (allOps) { setSelected(new Set()); setAllOps(false) } else { setSelected(new Set(OPS.map(o => o.id))); setAllOps(true) } }
  const ops: XOperation[] = allOps ? OPS.map(o => o.id) : Array.from(selected)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} className="animate-in">
      <PathPicker label="Output folder" value={outputDir} onChange={setOutputDir} hint="JSON logs saved here — deleted-posts.json, unliked-posts.json, unfollowed-accounts.json, etc." />
      <PathPicker label="Chrome profile folder" value={chromePath} onChange={setChromePath} hint="Stores your X login session between runs." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FieldRow label="Username (optional)">
          <input className="field" value={username} onChange={e => setUsername(e.target.value)} placeholder="@handle — auto-detected if blank" />
        </FieldRow>
        <FieldRow label="Delete limit">
          <input className="field" value={limit} onChange={e => setLimit(e.target.value)} placeholder="Infinity" />
        </FieldRow>
      </div>

      <FieldRow label="Operations">
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="check-row" style={{ color: 'var(--color-warn)' }}>
            <input type="checkbox" checked={allOps} onChange={toggleAll} /><Zap size={12} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>All of the above</span>
          </label>
          <hr className="divider" style={{ margin: '2px 0' }} />
          {OPS.map(op => (
            <label key={op.id} className="check-row">
              <input type="checkbox" checked={selected.has(op.id) || allOps} onChange={() => !allOps && toggleOp(op.id)} />
              <span style={{ color: 'var(--color-accent)' }}>{op.icon}</span>
              <span style={{ fontSize: 12 }}>{op.label}</span>
            </label>
          ))}
        </div>
      </FieldRow>

      <FilterPanel filters={filters} onChange={setFilters} />

      <FieldRow label="Log mode">
        <div style={{ display: 'flex', gap: 16 }}>
          {(['append', 'overwrite'] as const).map(m => (
            <label key={m} className="check-row">
              <input type="radio" name="logmode" checked={appendMode === (m === 'append')} onChange={() => setAppendMode(m === 'append')} />
              <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{m}</span>
            </label>
          ))}
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
          {appendMode ? 'New deletions are appended to existing log files' : 'Log files are overwritten on each run'}
        </p>
      </FieldRow>

      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Info size={13} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-muted-light)', lineHeight: 1.6 }}>
            Chrome opens automatically. If you're not logged in to X, a floating panel will appear in the browser — sign in, then click <strong style={{ color: 'var(--color-text)' }}>I'm logged in</strong>. The panel stays visible through page changes and checks every 30s automatically.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {!isRunning ? (
          <>
            <button className="btn btn-danger" disabled={!outputDir.trim() || !chromePath.trim() || ops.length === 0} onClick={() => {
              const deleteLimit = limit === 'Infinity' || !limit.trim() ? Infinity : Number(limit)
              onRun({ outputDir, chromePath, username: username.trim().replace('@', '') || undefined, deleteLimit, appendMode, operations: ops, filters })
            }}><Play size={13} /> Run cleanup</button>
            {outputDir.trim() && (
              <button className="btn btn-ghost" onClick={() => window.api.openFolder(outputDir)}>
                <FolderOpen size={13} /> Open output folder
              </button>
            )}
          </>
        ) : (
          <button className="btn btn-ghost" onClick={onStop}><Square size={13} /> Stop</button>
        )}
      </div>
    </div>
  )
}

// ── Forms tab ─────────────────────────────────────────────────────────────────
function FormsTab({ isRunning, onRun, onStop, defaultChromePath, defaultOutputPath, formsDonePath, onClearFormsDone }: {
  isRunning: boolean; onRun: (opts: any) => void; onStop: () => void
  defaultChromePath: string; defaultOutputPath: string
  formsDonePath: string; onClearFormsDone: () => void
}) {
  const [outputDir,  setOutputDir]  = useState('')
  const [chromePath, setChromePath] = useState('')
  const [formUrl,    setFormUrl]    = useState('')
  const [showResult, setShowResult] = useState(false)

  useEffect(() => { if (defaultOutputPath && !outputDir) setOutputDir(defaultOutputPath) }, [defaultOutputPath])
  useEffect(() => { if (defaultChromePath && !chromePath) setChromePath(defaultChromePath) }, [defaultChromePath])

  const canRun = outputDir.trim() && chromePath.trim() && formUrl.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} className="animate-in">
      {showResult && formsDonePath && (
        <FormsResultModal filePath={formsDonePath} onClose={() => setShowResult(false)} />
      )}

      <PathPicker label="Output folder" value={outputDir} onChange={setOutputDir} hint="form-fields.json will be saved here" />
      <PathPicker label="Chrome profile folder" value={chromePath} onChange={setChromePath} hint="Shared session with X Cleaner." />

      <FieldRow label="Google Forms URL">
        <input className="field" value={formUrl} onChange={e => setFormUrl(e.target.value)}
          placeholder="https://docs.google.com/forms/d/.../prefill" />
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
          Use the prefill or viewform URL. Must be a public or sign-in accessible Google Form.
        </p>
      </FieldRow>

      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Info size={13} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-muted-light)', lineHeight: 1.6 }}>
            Chrome opens with the form. If the form is already accessible, fields are extracted automatically with no prompts. If sign-in is required, a panel appears — log in, then click <strong style={{ color: 'var(--color-text)' }}>Done</strong>.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!isRunning ? (
          <>
            <button className="btn btn-primary" disabled={!canRun}
              onClick={() => { onClearFormsDone(); onRun({ outputDir, chromePath, formUrl }) }}>
              <Play size={13} /> Extract fields
            </button>
            {outputDir.trim() && (
              <button className="btn btn-ghost" onClick={() => window.api.openFolder(outputDir)}>
                <FolderOpen size={13} /> Open output folder
              </button>
            )}
            {formsDonePath && (
              <button className="btn btn-success" onClick={() => setShowResult(true)}>
                <Eye size={13} /> View results
              </button>
            )}
          </>
        ) : (
          <button className="btn btn-ghost" onClick={onStop}><Square size={13} /> Stop</button>
        )}
      </div>
    </div>
  )
}

// ── Results tab ───────────────────────────────────────────────────────────────
const FILE_LABELS: Record<string, string> = {
  'deleted-posts.json': 'Posts', 'deleted-replies.json': 'Replies',
  'unliked-posts.json': 'Unlikes', 'unfollowed-accounts.json': 'Unfollows', 'deleted-media.json': 'Media',
  'deleted-highlights.json': 'Highlights', 'form-fields.json': 'Form fields',
}

function ResultsTab({ defaultOutputPath }: { defaultOutputPath: string }) {
  const [dir,     setDir]     = useState('')
  const [files,   setFiles]   = useState<Record<string, unknown[]>>({})
  const [active,  setActive]  = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg,     setMsg]     = useState('')

  useEffect(() => { if (defaultOutputPath && !dir) setDir(defaultOutputPath) }, [defaultOutputPath])

  const load = async () => {
    if (!dir.trim()) return
    setLoading(true)
    const res = await window.api.readOutput(dir)
    setLoading(false)
    if (res.error) { setMsg(`Error: ${res.error}`); return }
    const f = res.files ?? {}
    setFiles(f)
    const keys = Object.keys(f)
    if (keys.length) setActive(keys[0])
    setMsg(keys.length ? '' : 'No JSON files found.')
  }

  const rows = (active ? files[active] ?? [] : []) as Record<string, unknown>[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} className="animate-in">
      <FieldRow label="Output folder">
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field" style={{ flex: 1 }} value={dir} onChange={e => setDir(e.target.value)} placeholder="C:\path\to\output" />
          <button className="btn btn-ghost" style={{ padding: '0 10px' }} onClick={async () => { const p = await pickDir(); if (p) setDir(p) }}><FolderOpen size={13} /></button>
          <button className="btn btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            {loading ? 'Loading…' : 'Load'}
          </button>
          {dir && <button className="btn btn-ghost" style={{ padding: '0 10px' }} onClick={() => window.api.openFolder(dir)}><ExternalLink size={13} /></button>}
        </div>
      </FieldRow>
      {msg && <p style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, margin: 0 }}>{msg}</p>}
      {Object.keys(files).length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(files).map(([name, arr]) => (
              <button key={name} onClick={() => setActive(name)} className="btn" style={{ fontSize: 11, padding: '4px 10px', background: active === name ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent', color: active === name ? 'var(--color-accent)' : 'var(--color-muted-light)', borderColor: active === name ? 'color-mix(in srgb, var(--color-accent) 35%, transparent)' : 'var(--color-border)' }}>
                {FILE_LABELS[name] ?? name} <span style={{ opacity: 0.5, marginLeft: 4 }}>{(arr as unknown[]).length}</span>
              </button>
            ))}
          </div>
          {rows.length > 0 && (
            <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--color-border)', borderRadius: 8 }}>
              <table className="data-table">
                <thead><tr>{Object.keys(rows[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{rows.map((row, i) => <tr key={i}>{Object.values(row).map((v, j) => <td key={j} title={String(v ?? '')}>{String(v ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────
function SettingsTab({ version, theme, onToggleTheme, defaultChromePath, isRunning }: {
  version: string; theme: Theme; onToggleTheme: () => void; defaultChromePath: string; isRunning: boolean
}) {
  const [profilePath, setProfilePath] = useState('')
  const [msg,         setMsg]         = useState('')
  const [updateMsg,   setUpdateMsg]   = useState('')
  const [starMsg,     setStarMsg]     = useState('')

  useEffect(() => { if (defaultChromePath && !profilePath) setProfilePath(defaultChromePath) }, [defaultChromePath])
  const flash = (setter: (v: string) => void, m: string) => { setter(m); setTimeout(() => setter(''), 6000) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }} className="animate-in">
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="label" style={{ marginBottom: 4, fontSize: 11 }}>Appearance</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sun size={14} style={{ color: 'var(--color-muted-light)' }} />
          <button className="theme-toggle" onClick={onToggleTheme} title="Toggle theme" />
          <Moon size={14} style={{ color: 'var(--color-muted-light)' }} />
          <span style={{ fontSize: 12, color: 'var(--color-muted-light)', marginLeft: 4 }}>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
        </div>
      </section>
      <hr className="divider" />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="label" style={{ marginBottom: 4, fontSize: 11 }}>Chrome profile</p>
        <PathPicker label="Profile folder path" value={profilePath} onChange={setProfilePath} hint="Delete this folder to force a fresh browser login on next run." />
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', borderColor: 'color-mix(in srgb, var(--color-danger) 30%, transparent)', color: 'var(--color-danger)' }} disabled={!profilePath.trim()} onClick={async () => { const res = await window.api.resetProfile(profilePath); flash(setMsg, res.error ? `✗ ${res.error}` : `✓ ${res.message}`) }}>
          <RotateCcw size={13} /> Reset profile
        </button>
        {msg && <p style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: msg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)' }}>{msg}</p>}
      </section>
      <hr className="divider" />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="label" style={{ marginBottom: 4, fontSize: 11 }}>GitHub</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => window.api.openUrl('https://github.com/mahmadabid/vibed-puppet')}>
            <GithubIcon size={13} /> View on GitHub
          </button>
          <button className="btn btn-ghost" style={{ borderColor: 'color-mix(in srgb, var(--color-warn) 40%, transparent)', color: 'var(--color-warn)' }}
            disabled={isRunning || !profilePath.trim()}
            onClick={async () => {
              setStarMsg('Opening GitHub…')
              const result = await window.api.githubStar(profilePath || defaultChromePath)
              flash(setStarMsg, result.success ? (result.alreadyStarred ? '⭐ Already starred!' : '⭐ Starred! Thank you!') : `✗ ${result.error ?? 'Failed'}`)
            }}>
            <Star size={13} /> Star on GitHub
          </button>
        </div>
        {starMsg && <p style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: starMsg.includes('✗') ? 'var(--color-danger)' : 'var(--color-warn)' }}>{starMsg}</p>}
      </section>
      <hr className="divider" />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="label" style={{ marginBottom: 4, fontSize: 11 }}>Updates</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost" onClick={async () => { await window.api.checkForUpdates(); flash(setUpdateMsg, 'Checking GitHub releases…') }}>
            <Download size={13} /> Check for updates
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted)' }}>v{version}</span>
        </div>
        {updateMsg && <p style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-muted-light)' }}>{updateMsg}</p>}
      </section>
    </div>
  )
}

// ── Log panel ─────────────────────────────────────────────────────────────────
function LogPanel({ log, status, onClear }: { log: string; status: Status; onClear: () => void }) {
  const [open,   setOpen]   = useState(true)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [log])
  const copyLog = async () => {
    if (!log) return
    try { await navigator.clipboard.writeText(log); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }
  return (
    <div style={{ borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', height: open ? 220 : 36, transition: 'height 0.2s ease', flexShrink: 0 }}>
      <div onClick={() => setOpen(o => !o)} style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', cursor: 'pointer', flexShrink: 0, background: 'var(--color-panel-alt)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Terminal size={12} style={{ color: 'var(--color-muted)' }} />
          <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>Output</span>
          <StatusDot status={status} />
        </div>
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          {log && <button onClick={copyLog} title="Copy log" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--color-success)' : 'var(--color-muted)', fontSize: 11 }}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>}
          <button onClick={onClear} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px' }}>Clear</button>
          <span style={{ color: 'var(--color-muted)', display: 'flex', alignItems: 'center' }}>{open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</span>
        </div>
      </div>
      {open && (
        <div ref={ref} style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', background: 'var(--color-bg)' }}>
          {log
            ? <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-text)', WebkitUserSelect: 'text', userSelect: 'text', cursor: 'text' }}>{log}</pre>
            : <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted)', margin: 0 }}>No output yet. Run a task to see logs here.</p>
          }
        </div>
      )}
    </div>
  )
}

// ── Titlebar ──────────────────────────────────────────────────────────────────
function Titlebar({ status, theme, onToggleTheme, defaultChromePath }: {
  status: Status; theme: Theme; onToggleTheme: () => void; defaultChromePath: string
}) {
  const isMac = navigator.userAgent.includes('Mac')
  const [starMsg, setStarMsg] = useState('')
  const flash = (m: string) => { setStarMsg(m); setTimeout(() => setStarMsg(''), 3000) }
  return (
    <div className="drag" style={{ height: 42, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', background: 'var(--color-panel)', flexShrink: 0, position: 'relative', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: isMac ? 72 : 0 }}>
        <VPLogo size={22} />
        <span style={{ fontWeight: 300, fontSize: 13.5, color: 'var(--color-text)' }}>vibed <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>puppet</span></span>
        <div style={{ width: 1, height: 12, background: 'var(--color-border)', margin: '0 4px' }} />
        <StatusDot status={status} />
        {starMsg && <span style={{ fontSize: 10, color: 'var(--color-accent)', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>{starMsg}</span>}
      </div>
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center' }}>
        <button onClick={async () => { const r = await window.api.githubStar(defaultChromePath); flash(r.success ? (r.alreadyStarred ? '⭐ Already starred!' : '⭐ Starred!') : '✗ Failed') }} title="Star on GitHub" style={{ width: 36, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-warn)' }}>
          <Star size={14} />
        </button>
        <button onClick={() => window.api.openUrl('https://github.com/mahmadabid/vibed-puppet')} title="GitHub" style={{ width: 36, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}>
          <GithubIcon size={14} />
        </button>
        <button onClick={onToggleTheme} title="Toggle theme" style={{ width: 36, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        {!isMac && (
          <>
            <button onClick={() => window.api.windowMinimize()} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)' }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }} style={{ width: 36, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', transition: 'background .12s' }}><Minus size={13} /></button>
            <button onClick={() => window.api.windowMaximize()} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)' }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }} style={{ width: 36, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', transition: 'background .12s' }}><Maximize2 size={11} /></button>
            <button onClick={() => window.api.windowClose()} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--color-danger) 18%, transparent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger)' }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-muted)' }} style={{ width: 36, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', transition: 'background .12s, color .12s' }}><X size={13} /></button>
          </>
        )}
      </div>
      <div className="titlebar-accent" />
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const NAV: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'cleaner',  label: 'X Cleaner',      icon: <Trash2 size={14} /> },
  { id: 'forms',    label: 'Forms extractor', icon: <FileJson size={14} /> },
  { id: 'results',  label: 'Results',         icon: <CheckSquare size={14} /> },
  { id: 'settings', label: 'Settings',        icon: <Settings size={14} /> },
]
function Sidebar({ active, onTab }: { active: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav style={{ width: 176, flexShrink: 0, background: 'var(--color-panel)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', padding: 8, gap: 2 }}>
      {NAV.map(item => (
        <button key={item.id} onClick={() => onTab(item.id)} className={`nav-item${active === item.id ? ' active' : ''}`}>
          {item.icon}<span style={{ fontSize: 12.5 }}>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
function AppInner() {
  const [tab,           setTab]          = useState<Tab>('cleaner')
  const [log,           setLog]          = useState('')
  const [status,        setStatus]       = useState<Status>('idle')
  const [version,       setVersion]      = useState('…')
  const [summary,       setSummary]      = useState<RunSummary | null>(null)
  const [formsDonePath, setFormsDonePath] = useState('')
  const [dcp,           setDcp]          = useState('')
  const [dop,           setDop]          = useState('')
  const [theme,         toggleTheme]     = useTheme()
  const isRunning = status === 'running'

  useEffect(() => {
    const offs = [
      window.api.onLog(msg  => setLog(prev => prev + msg)),
      window.api.onStatus(s => setStatus(s as Status)),
      window.api.onRunSummary(d => setSummary(d as RunSummary)),
      window.api.onFormsDone(path => setFormsDonePath(path)),
    ]
    window.api.getVersion().then(setVersion).catch(() => {})
    window.api.getDefaultPaths().then(p => { setDcp(p.chromePath); setDop(p.outputPath) }).catch(() => {})
    return () => offs.forEach(o => o())
  }, [])

  const runX     = useCallback((opts: any) => { setLog(''); setSummary(null); window.api.runXCleaner(opts) }, [])
  const runForms = useCallback((opts: any) => { setLog(''); setSummary(null); window.api.runFormsExtractor(opts) }, [])
  const stop     = useCallback(() => window.api.stop(), [])

  const meta: Record<Tab, { title: string; sub: string }> = {
    cleaner:  { title: 'X / Twitter cleanup',    sub: 'Delete posts, replies, media, highlights. Bulk unlike and unfollow.' },
    forms:    { title: 'Google Forms extractor', sub: 'Extract field entry IDs from any Google Form — automatically.' },
    results:  { title: 'Results',                sub: 'Browse JSON logs from previous runs.' },
    settings: { title: 'Settings',               sub: 'Theme, Chrome profile, GitHub, and updates.' },
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
      {summary && <SummaryModal summary={summary} onClose={() => setSummary(null)} />}
      <Titlebar status={status} theme={theme} onToggleTheme={toggleTheme} defaultChromePath={dcp} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar active={tab} onTab={setTab} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            <div style={{ maxWidth: 680 }}>
              <h1 style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 600 }}>{meta[tab].title}</h1>
              <p style={{ margin: '0 0 22px', fontSize: 12, color: 'var(--color-muted-light)', lineHeight: 1.5 }}>{meta[tab].sub}</p>
              {tab === 'cleaner'  && <XCleanerTab  isRunning={isRunning} onRun={runX}     onStop={stop} defaultChromePath={dcp} defaultOutputPath={dop} />}
              {tab === 'forms'    && <FormsTab     isRunning={isRunning} onRun={runForms} onStop={stop} defaultChromePath={dcp} defaultOutputPath={dop} formsDonePath={formsDonePath} onClearFormsDone={() => setFormsDonePath('')} />}
              {tab === 'results'  && <ResultsTab   defaultOutputPath={dop} />}
              {tab === 'settings' && <SettingsTab  version={version} theme={theme} onToggleTheme={toggleTheme} defaultChromePath={dcp} isRunning={isRunning} />}
            </div>
          </div>
          <LogPanel log={log} status={status} onClear={() => setLog('')} />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
