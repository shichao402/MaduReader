import { describe, expect, it, vi } from 'vitest'
import { createOpenRequestReceiver, type OpenRequest, type ReceiverDependencies } from '../../src/lib/openRequestReceiver'
import type { OpenResult } from '../../src/lib/openPaths'

const ok = (paths: string[]): OpenResult => ({ error: null, outcomes: paths.map((path) => ({ path, error: null })) })
const request = (id: number, paths = [`${id}.md`]): OpenRequest => ({ id, paths, source: 'relaunch', error: null })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let index = 0; index < 15; index++) await Promise.resolve() }

function harness(initial: OpenRequest[] = []) {
  const queue = [...initial]
  let page = 0
  let ready = false
  let notify = () => {}
  let ackFailure = false
  let ackResponseFailure = false
  const acknowledgments: { requestId: number; result: OpenResult }[] = []
  const dependencies: ReceiverDependencies = {
    invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case 'frontend_begin': ready = false; return { pageId: ++page, hasRequests: queue.length > 0 }
        case 'frontend_ready': ready = args?.pageId === page; return ready
        case 'next_open_request': return ready && args?.pageId === page ? queue[0] || null : null
        case 'complete_open_request': {
          if (ackFailure) { ackFailure = false; throw new Error('IPC unavailable') }
          if (args?.pageId !== page || queue[0]?.id !== args?.requestId) return false
          acknowledgments.push({ requestId: args!.requestId as number, result: args!.result as OpenResult })
          queue.shift()
          if (ackResponseFailure) { ackResponseFailure = false; throw new Error('ACK response lost') }
          return true
        }
        case 'app_ready': return undefined
        default: throw new Error(command)
      }
    }) as ReceiverDependencies['invoke'],
    listen: vi.fn(async (callback) => { notify = callback; return vi.fn() }),
    initialize: vi.fn(async () => {}),
    execute: vi.fn(async (paths) => ok(paths)),
    onError: vi.fn(),
    afterPaint: vi.fn(async () => {}),
    url: 'tauri://localhost/',
  }
  return {
    queue, dependencies, acknowledgments,
    notify: () => notify(),
    failAck: () => { ackFailure = true },
    loseAckResponse: () => { ackResponseFailure = true },
  }
}

describe('reliable page request receiver', () => {
  it('listens before registration, initializes before ready, confirms after execution', async () => {
    const h = harness([request(1)])
    const receiver = createOpenRequestReceiver(h.dependencies)
    await receiver.start()
    expect(h.dependencies.initialize).toHaveBeenCalledWith(true)
    expect(h.dependencies.listen.mock.invocationCallOrder[0]).toBeLessThan(h.dependencies.invoke.mock.invocationCallOrder[0])
    const commands = vi.mocked(h.dependencies.invoke).mock.calls.map(([command]) => command)
    expect(commands).toEqual(['frontend_begin', 'frontend_ready', 'next_open_request', 'complete_open_request', 'next_open_request', 'app_ready'])
    expect(h.queue).toHaveLength(0)
    expect(h.acknowledgments[0].result).toEqual(ok(['1.md']))
    receiver.stop()
  })
  it('start is idempotent within one page', async () => {
    const h = harness([request(1)])
    const receiver = createOpenRequestReceiver(h.dependencies)
    await Promise.all([receiver.start(), receiver.start()])
    expect(h.dependencies.listen).toHaveBeenCalledTimes(1)
    expect(h.dependencies.execute).toHaveBeenCalledTimes(1)
  })
  it('notification lost before listener is irrelevant because startup drains', async () => {
    const h = harness([request(1), request(2)])
    h.notify()
    await createOpenRequestReceiver(h.dependencies).start()
    expect(h.acknowledgments.map((ack) => ack.requestId)).toEqual([1, 2])
  })
  it('a request arriving during restore runs only after restore completes', async () => {
    const h = harness()
    const restore = deferred<void>()
    h.dependencies.initialize = vi.fn(() => restore.promise)
    const receiver = createOpenRequestReceiver(h.dependencies)
    const started = receiver.start()
    await flush()
    h.queue.push(request(1))
    h.notify()
    await flush()
    expect(h.dependencies.execute).not.toHaveBeenCalled()
    restore.resolve()
    await started
    expect(h.dependencies.initialize).toHaveBeenCalledWith(false)
    expect(h.dependencies.execute).toHaveBeenCalledWith(['1.md'])
  })
  it('drains new requests arriving during restore even without a notification', async () => {
    const h = harness()
    h.dependencies.initialize = vi.fn(async () => { h.queue.push(request(9)) })
    await createOpenRequestReceiver(h.dependencies).start()
    expect(h.acknowledgments[0].requestId).toBe(9)
  })
  it('does not execute concurrently during repeated notifications', async () => {
    const h = harness([request(1)])
    const execution = deferred<OpenResult>()
    vi.mocked(h.dependencies.execute).mockImplementationOnce(() => execution.promise)
    const receiver = createOpenRequestReceiver(h.dependencies)
    const started = receiver.start()
    await flush()
    h.queue.push(request(2))
    h.notify(); h.notify(); h.notify()
    await flush()
    expect(h.dependencies.execute).toHaveBeenCalledTimes(1)
    execution.resolve(ok(['1.md']))
    await started
    expect(h.acknowledgments.map((ack) => ack.requestId)).toEqual([1, 2])
  })
  it('idle ready pages respond to notifications', async () => {
    const h = harness()
    const receiver = createOpenRequestReceiver(h.dependencies)
    await receiver.start()
    h.queue.push(request(3)); h.notify()
    await flush()
    expect(h.acknowledgments[0].requestId).toBe(3)
  })
  it('business failure is explicitly acknowledged and does not block later requests', async () => {
    const h = harness([request(1), request(2)])
    vi.mocked(h.dependencies.execute).mockRejectedValueOnce(new Error('permission denied'))
    await createOpenRequestReceiver(h.dependencies).start()
    expect(h.acknowledgments[0].result.error).toBe('permission denied')
    expect(h.dependencies.onError).toHaveBeenCalledWith(expect.objectContaining({ requestId: 1, details: 'permission denied' }))
    expect(h.acknowledgments).toHaveLength(2)
  })
  it('invalid launch options fail visibly without calling the file service', async () => {
    const h = harness([{ ...request(1, []), error: '不支持的启动参数 --open' }])
    await createOpenRequestReceiver(h.dependencies).start()
    expect(h.dependencies.execute).not.toHaveBeenCalled()
    expect(h.acknowledgments[0].result.error).toContain('--open')
  })
  it('partial results retain path errors in the acknowledgment and UI', async () => {
    const h = harness([request(1, ['ok.md', 'bad.md'])])
    vi.mocked(h.dependencies.execute).mockResolvedValue({ error: null, outcomes: [{ path: 'ok.md', error: null }, { path: 'bad.md', error: 'missing' }] })
    await createOpenRequestReceiver(h.dependencies).start()
    expect(h.dependencies.onError).toHaveBeenCalledWith(expect.objectContaining({ details: 'bad.md\nmissing' }))
    expect(h.acknowledgments[0].result.outcomes).toHaveLength(2)
  })
  it('ACK transport failure preserves request and retry only resends the result', async () => {
    const h = harness([request(1)])
    h.failAck()
    const receiver = createOpenRequestReceiver(h.dependencies)
    await receiver.start()
    expect(h.queue).toHaveLength(1)
    expect(h.dependencies.onError).toHaveBeenCalledWith(expect.objectContaining({ retry: true }))
    await receiver.retry()
    expect(h.queue).toHaveLength(0)
    expect(h.dependencies.execute).toHaveBeenCalledTimes(1)
  })
  it('lost ACK response does not replay an already completed request', async () => {
    const h = harness([request(1), request(2)])
    h.loseAckResponse()
    const receiver = createOpenRequestReceiver(h.dependencies)
    await receiver.start()
    expect(h.queue.map((item) => item.id)).toEqual([2])
    await receiver.retry()
    expect(h.dependencies.execute).toHaveBeenCalledTimes(2)
    expect(h.acknowledgments.map((item) => item.requestId)).toEqual([1, 2])
  })
  it('reload during execution leaves the request for the new page and rejects old work', async () => {
    const h = harness([request(1)])
    const execution = deferred<OpenResult>()
    vi.mocked(h.dependencies.execute).mockImplementationOnce(() => execution.promise)
    const old = createOpenRequestReceiver(h.dependencies)
    const started = old.start()
    await flush()
    old.stop()
    const next = createOpenRequestReceiver(h.dependencies)
    await next.start()
    execution.resolve(ok(['1.md']))
    await started
    expect(h.acknowledgments).toHaveLength(1)
    expect(h.queue).toHaveLength(0)
  })
  it('stop during initialization never announces ready or consumes requests', async () => {
    const h = harness([request(1)])
    const initialization = deferred<void>()
    h.dependencies.initialize = () => initialization.promise
    const receiver = createOpenRequestReceiver(h.dependencies)
    const started = receiver.start()
    await flush(); receiver.stop(); initialization.resolve(); await started
    expect(h.dependencies.execute).not.toHaveBeenCalled()
    expect(vi.mocked(h.dependencies.invoke).mock.calls.map(([command]) => command)).not.toContain('frontend_ready')
    expect(h.queue).toHaveLength(1)
  })
  it('initial registration failure is recoverable by explicit retry', async () => {
    const h = harness([request(1)])
    vi.mocked(h.dependencies.invoke).mockRejectedValueOnce(new Error('temporary IPC error'))
    const receiver = createOpenRequestReceiver(h.dependencies)
    await receiver.start()
    expect(h.dependencies.execute).not.toHaveBeenCalled()
    await receiver.retry()
    expect(h.queue).toHaveLength(0)
  })
})
