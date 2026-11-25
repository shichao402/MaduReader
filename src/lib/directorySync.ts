import { watchImmediate, type UnwatchFn, type WatchEvent } from '@tauri-apps/plugin-fs'
import { allowPath } from './fsAccess'
import { perfLog } from './perfLog'

const DEBOUNCE_MS = 300
const MAX_WAIT_MS = 2_000
const RECONCILE_MS = 60_000
const FALLBACK_MS = 10_000

type Timer = ReturnType<typeof setTimeout>

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
    .replace(/^\/\/\?\/UNC\//i, '//')
    .replace(/^\/\/\?\//, '')
    .replace(/\/+$/, '') || '/'
}

/** Only exclude paths demonstrably inside an ignored subtree, never ambiguous/root events. */
function isIgnoredEvent(event: WatchEvent, root: string, windowsPath: boolean): boolean {
  const kind = event.type
  if (typeof kind === 'object' && kind !== null && 'access' in kind) return true
  if (typeof kind !== 'object' || kind === null) return false
  if ('modify' in kind && kind.modify.kind === 'metadata' && kind.modify.mode === 'access-time') {
    return true
  }
  if (!('create' in kind || 'modify' in kind || 'remove' in kind)) return false
  if (!event.paths?.length) return false
  const prefix = root.endsWith('/') ? root : `${root}/`
  return event.paths.every((path) => {
    const normalized = normalizePath(path)
    const compared = windowsPath ? normalized.toLowerCase() : normalized
    if (!compared.startsWith(prefix)) return false
    // Use original case for names: match the directory scanner's exclusions exactly.
    const segments = normalized.slice(prefix.length).split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false
    return segments.some((segment) => segment.startsWith('.') || segment === 'node_modules')
  })
}

/**
 * Raw events only mark the directory dirty; refresh owns the full tree scan.
 * The caller owns the initial directory load and effect cleanup on workspace changes.
 * Watch attachment also requests a scan to close the asynchronous startup gap.
 *
 * plugin-fs 2.5.2 drops notify runtime errors (its channel sends only Ok events).
 * A live handle is therefore not proof of a healthy watch: reconcile and rebuild
 * every foreground minute, and also rebuild on focus/visibility/pageshow. Startup
 * failures use foreground 10-second polling and watch retries instead. Pending
 * startups are kept across maintenance ticks, never multiplied by periodic rebuilds.
 */
export function startDirectorySync(
  path: string,
  refresh: () => Promise<void>,
  options: { recursive?: boolean } = {},
): () => void {
  const recursive = options.recursive ?? true
  const normalizedRoot = normalizePath(path)
  const windowsPath = /^[a-z]:\//i.test(normalizedRoot) || normalizedRoot.startsWith('//')
  const root = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot
  let disposed = false
  let paused = document.visibilityState === 'hidden'
  let dirty = false
  let scanning = false
  let firstDirtyAt: number | undefined
  let debounceTimer: Timer | undefined
  let maintenanceTimer: Timer | undefined
  let unwatch: UnwatchFn | undefined
  let generation = 0
  let pendingWatch: number | undefined

  const log = (message: string) => { void perfLog(`[directorySync] ${message}: ${path}`) }
  const active = () => !disposed && !paused && document.visibilityState !== 'hidden'
  const current = (token: number) => active() && generation === token

  function clearDebounce() {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = undefined
    firstDirtyAt = undefined
  }

  function clearMaintenance() {
    if (maintenanceTimer !== undefined) clearTimeout(maintenanceTimer)
    maintenanceTimer = undefined
  }

  function release(stop: UnwatchFn, reason: string) {
    try {
      // plugin-fs's UnwatchFn returns void, not its asynchronous Resource.close promise.
      stop()
      log(`watch stopped (${reason}; release requested)`)
    } catch (error) {
      log(`watch stop failed (${reason}): ${String(error)}`)
    }
  }

  function stopWatch(reason: string) {
    ++generation
    pendingWatch = undefined
    const stop = unwatch
    unwatch = undefined
    if (stop) release(stop, reason)
  }

  async function scan() {
    if (!active() || scanning || !dirty) return
    clearDebounce()
    scanning = true
    try {
      // Events arriving during an awaited refresh cause one additional serial pass.
      while (active() && dirty) {
        dirty = false
        try {
          await refresh()
        } catch (error) {
          log(`refresh failed: ${String(error)}`)
          // Do not hot-loop on failures; the next event/reconciliation can retry.
        }
      }
    } finally {
      scanning = false
    }
  }

  function requestScan(immediate = false) {
    if (disposed) return
    dirty = true
    if (!active() || scanning) return
    if (immediate) {
      void scan()
      return
    }
    firstDirtyAt ??= Date.now()
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    const delay = Math.min(DEBOUNCE_MS, Math.max(0, MAX_WAIT_MS - (Date.now() - firstDirtyAt)))
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      void scan()
    }, delay)
  }

  function scheduleMaintenance() {
    clearMaintenance()
    if (!active()) return
    maintenanceTimer = setTimeout(() => {
      maintenanceTimer = undefined
      if (!active()) return
      // notify runtime failures/root replacements can silently detach a live handle.
      // Only retire attached watchers; never invalidate or multiply a pending startup.
      if (unwatch) stopWatch('periodic foreground recovery')
      requestScan(true)
      void startWatch()
      scheduleMaintenance()
    }, unwatch ? RECONCILE_MS : FALLBACK_MS)
  }

  async function startWatch() {
    if (!active() || unwatch || pendingWatch !== undefined) return
    const token = ++generation
    pendingWatch = token
    log('watch starting')
    try {
      // Always authorize via the same recursive fs scope used by directory reads.
      await allowPath(path)
      if (!current(token)) return
      const stop = await watchImmediate(path, (event) => {
        if (current(token) && !isIgnoredEvent(event, root, windowsPath)) requestScan()
      }, { recursive })
      if (!current(token)) {
        release(stop, 'late startup after pause/dispose/restart')
        return
      }
      pendingWatch = undefined
      unwatch = stop
      log('watch started')
      scheduleMaintenance()
      requestScan(true)
    } catch (error) {
      if (!current(token)) return
      pendingWatch = undefined
      log(`watch degraded to foreground 10s polling/retry: ${String(error)}`)
      scheduleMaintenance()
      requestScan(true)
    }
  }

  function pause(reason: string) {
    if (disposed) return
    paused = true
    dirty = true
    clearDebounce()
    clearMaintenance()
    stopWatch(reason)
  }

  function wake() {
    if (disposed || document.visibilityState === 'hidden') return
    paused = false
    // Rebuild even an apparently live watcher: runtime errors are not observable.
    // Keep an in-flight startup to avoid multiplying watchers on a burst of wake events.
    if (unwatch) stopWatch('foreground recovery')
    void startWatch()
    scheduleMaintenance()
    requestScan(true)
  }

  const visibility = () => {
    if (document.visibilityState === 'hidden') pause('background')
    else wake()
  }
  const pagehide = () => pause('pagehide')
  const beforeunload = () => pause('beforeunload')
  const hideBeforeClose = () => pause('madu:hide-before-close')

  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('focus', wake)
  window.addEventListener('pageshow', wake)
  window.addEventListener('pagehide', pagehide)
  window.addEventListener('beforeunload', beforeunload)
  window.addEventListener('madu:hide-before-close', hideBeforeClose)
  if (active()) {
    void startWatch()
    scheduleMaintenance()
  }

  return () => {
    if (disposed) return
    disposed = true
    dirty = false
    clearDebounce()
    clearMaintenance()
    stopWatch('dispose')
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('focus', wake)
    window.removeEventListener('pageshow', wake)
    window.removeEventListener('pagehide', pagehide)
    window.removeEventListener('beforeunload', beforeunload)
    window.removeEventListener('madu:hide-before-close', hideBeforeClose)
    // refresh has no cancellation API; an already-started scan may finish, but no
    // new scan/retry/timer can be scheduled after this cleanup.
  }
}
