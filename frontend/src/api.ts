/** 统一 fetch 帮手：JSON 序列化 + 错误信息提取（FastAPI 的 detail 字段）。 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData
  const res = await fetch(path, {
    ...init,
    headers: isForm ? undefined : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) msg = String(data.detail)
    } catch {
      /* 非 JSON 错误体，保留状态码信息 */
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

/** SSE 事件（v2.3-1 面试官流式输出）。 */
export interface StreamEvent {
  type: 'meta' | 'delta' | 'status' | 'done' | 'error'
  text?: string
  session_id?: number
  turn_meta?: { action: string; question_type: string | null; is_main_question: boolean }
  message?: string
  session?: unknown
}

/** POST + SSE 流读取：逐 `data:` 行回调（fetch ReadableStream 手解析，EventSource 不支持 POST）。 */
export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) msg = String(data.detail)
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(msg)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '')
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      try {
        onEvent(JSON.parse(payload) as StreamEvent)
      } catch {
        /* 跳过残包 */
      }
    }
  }
}
