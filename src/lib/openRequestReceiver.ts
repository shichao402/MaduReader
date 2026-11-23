import type { OpenErrorNotice, OpenResult } from './openPaths'
import { noticeForResult } from './openPaths'

export interface OpenRequest {
  id: number
  source: string
  paths: string[]
  error: string | null
}

interface Registration {
  pageId: number
  hasRequests: boolean
}

export interface ReceiverDependencies {
  invoke: <T>(command: string, arguments_?: Record<string, unknown>) => Promise<T>
  listen: (notify: () => void) => Promise<() => void>
  initialize: (hasRequests: boolean) => Promise<void>
  execute: (paths: string[]) => Promise<OpenResult>
  onError: (notice: OpenErrorNotice) => void
  afterPaint: () => Promise<void>
  url: string
}

/** 事件只是唤醒提示；新页面必拉队列。一个页面同一时刻只有一个 drain。 */
export function createOpenRequestReceiver(dependencies: ReceiverDependencies) {
  let stopped = false
  let ready = false
  let pageId: number | undefined
  let unlisten: (() => void) | undefined
  let starting: Promise<void> | undefined
  let draining: Promise<void> | undefined
  let signaled = false
  // 打开成功但 ACK 传输失败时，手动重试只补确认，不重复执行业务。
  let completed: { id: number; result: OpenResult } | undefined

  function transportError(error: unknown) {
    if (stopped) return
    console.error('[Open] Request transport failed; request retained:', error)
    dependencies.onError({
      title: '打开请求暂未处理完成',
      details: `请求仍保留，可重试。\n${error instanceof Error ? error.message : String(error)}`,
      retry: true,
    })
  }

  async function consume() {
    do {
      signaled = false
      while (!stopped && ready && pageId !== undefined) {
        const request = await dependencies.invoke<OpenRequest | null>('next_open_request', { pageId })
        if (stopped || !request) break
        let result = completed?.id === request.id ? completed.result : undefined
        if (!result) {
          if (request.error) {
            result = { error: request.error, outcomes: [] }
          } else {
            try {
              result = await dependencies.execute(request.paths)
            } catch (error) {
              result = { error: error instanceof Error ? error.message : String(error), outcomes: [] }
            }
          }
          if (stopped) return
          completed = { id: request.id, result }
          const notice = noticeForResult(result, request.id)
          if (notice) dependencies.onError(notice)
        }
        const acknowledged = await dependencies.invoke<boolean>('complete_open_request', {
          pageId, requestId: request.id, result,
        })
        if (stopped) return
        if (!acknowledged) {
          // 已确认或页面租约过期；前者队首已前进，后者后端不会再向旧页面交付。
          console.info('[Open] Completion ignored (stale or already completed):', request.id)
        }
        completed = undefined
      }
    } while (signaled && !stopped && ready)
  }

  function drain(): Promise<void> {
    signaled = true
    if (!ready || stopped) return Promise.resolve()
    if (!draining) {
      draining = consume().catch(transportError).finally(() => { draining = undefined })
    }
    return draining
  }

  async function startOnce() {
    unlisten = await dependencies.listen(() => { void drain() })
    if (stopped) { unlisten(); return }
    const registration = await dependencies.invoke<Registration>('frontend_begin', { url: dependencies.url })
    pageId = registration.pageId
    if (stopped) return
    // 复用原规则：有外部请求不恢复旧会话；恢复过程中到达的请求等恢复结束后执行。
    await dependencies.initialize(registration.hasRequests)
    if (stopped) return
    ready = await dependencies.invoke<boolean>('frontend_ready', { pageId })
    if (!ready) throw new Error('页面执行租约已失效')
    await drain()
    await dependencies.afterPaint()
    if (!stopped) await dependencies.invoke('app_ready', { pageId })
  }

  return {
    start(): Promise<void> {
      if (!starting) starting = startOnce().catch(transportError)
      return starting
    },
    async retry() {
      if (stopped) return
      if (ready) { await drain(); return }
      unlisten?.()
      starting = undefined
      await this.start()
    },
    stop() {
      stopped = true
      ready = false
      unlisten?.()
    },
  }
}
