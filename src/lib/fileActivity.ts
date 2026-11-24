export type OpenFilesSort = 'recent' | 'frequent' | 'name'

export interface FileActivity {
  path: string
  lastAccessedAt: number
  accessCount: number
}

/** 不活跃列表只保留路径和生命周期元数据，绝不保留正文。 */
export interface InactiveFile extends FileActivity {
  inactiveSince: number
}

export interface FilePolicy {
  maxOpenFiles: number
  inactiveRetentionDays: number
  openFilesSort: OpenFilesSort
}

export const DEFAULT_FILE_POLICY: FilePolicy = {
  maxOpenFiles: 20,
  inactiveRetentionDays: 7,
  openFilesSort: 'recent',
}

export const DAY_MS = 24 * 60 * 60 * 1000

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value))) : fallback
}

export function sanitizeFilePolicy(raw: Partial<FilePolicy>): FilePolicy {
  return {
    maxOpenFiles: boundedInteger(raw.maxOpenFiles, DEFAULT_FILE_POLICY.maxOpenFiles, 1, 200),
    inactiveRetentionDays: boundedInteger(raw.inactiveRetentionDays, DEFAULT_FILE_POLICY.inactiveRetentionDays, 1, 365),
    openFilesSort: ['recent', 'frequent', 'name'].includes(raw.openFilesSort ?? '')
      ? raw.openFilesSort! : DEFAULT_FILE_POLICY.openFilesSort,
  }
}

export function filePathKey(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(slashed) || slashed.startsWith('//') ? slashed.toLowerCase() : slashed
}

export function sanitizeActivity(raw: unknown, now = Date.now()): FileActivity | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<FileActivity>
  if (typeof value.path !== 'string' || !value.path.trim() || value.path.length > 32768) return null
  return {
    path: value.path,
    lastAccessedAt: boundedInteger(value.lastAccessedAt, now, 0, now),
    accessCount: boundedInteger(value.accessCount, 1, 1, Number.MAX_SAFE_INTEGER),
  }
}

export function sanitizeInactive(raw: unknown, now = Date.now()): InactiveFile | null {
  const activity = sanitizeActivity(raw, now)
  if (!activity) return null
  const value = raw as Partial<InactiveFile>
  return { ...activity, inactiveSince: boundedInteger(value.inactiveSince, now, 0, now) }
}

export function compareFileActivity(
  a: { path: string; name?: string; lastAccessedAt?: number; accessCount?: number },
  b: { path: string; name?: string; lastAccessedAt?: number; accessCount?: number },
  sort: OpenFilesSort,
): number {
  if (sort === 'frequent') {
    const frequency = (b.accessCount ?? 1) - (a.accessCount ?? 1)
    if (frequency) return frequency
  }
  if (sort !== 'name') {
    const recent = (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0)
    if (recent) return recent
  }
  const name = (a.name ?? a.path.split('/').pop() ?? a.path)
    .localeCompare(b.name ?? b.path.split('/').pop() ?? b.path, 'zh-CN', { numeric: true })
  return name || a.path.localeCompare(b.path)
}
