/** 简历页（D2：profile 迁移 useQuery，导入走 useMutation）。 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { type ProfileDTO } from '../types'

interface Msg {
  kind: 'ok' | 'error' | 'info'
  text: string
}

export default function ResumePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [msg, setMsg] = useState<Msg | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  // v2.6-2 冷启动：首次导入成功后给「去面试」引导
  const [justImported, setJustImported] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const profileQ = useQuery({
    queryKey: ['profile'],
    queryFn: () => api<{ profile: ProfileDTO | null }>('/api/profile').then((d) => d.profile),
  })
  const profile = profileQ.data ?? null

  // 派生而非 effect：无档案时直接展示上传表单；加载失败直接派生错误条
  const effectiveShowUpload = showUpload || (profileQ.isSuccess && !profileQ.data)
  const loadError: Msg | null = profileQ.isError
    ? { kind: 'error', text: `加载失败：${(profileQ.error as Error).message}` }
    : null
  const shownMsg = msg ?? loadError

  const importPdf = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api<{ profile: ProfileDTO }>('/api/profile/import', { method: 'POST', body: form })
    },
    onSuccess: (d) => {
      const wasFirst = !profile
      qc.setQueryData(['profile'], d.profile)
      setShowUpload(false)
      setJustImported(wasFirst)
      setMsg({ kind: 'ok', text: '导入完成，面试与复盘将直接使用这份简历全文' })
    },
    onError: (e) => setMsg({ kind: 'error', text: `导入失败：${(e as Error).message}` }),
  })

  function handleImport() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setMsg({ kind: 'error', text: '请先选择 PDF 文件' })
      return
    }
    setMsg({ kind: 'info', text: '正在提取简历全文（几秒钟）…' })
    importPdf.mutate(file)
  }

  const pending = importPdf.isPending

  if (profileQ.isPending) return <p>加载中…</p>

  if (!profile || effectiveShowUpload) {
    return (
      <section className="card">
        <h2>{profile ? '导入新简历' : '导入简历'}</h2>
        <p className="muted">选择 PDF 简历（文本版，非扫描件）。导入后原版预览 + 提取全文，AI 面试官直接读全文出题。</p>
        <div className="upload-row">
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" />
          <button className="btn primary" onClick={handleImport} disabled={pending}>
            {pending ? '导入中…' : '导入简历'}
          </button>
          {profile && (
            <button className="btn" onClick={() => setShowUpload(false)} disabled={pending}>
              取消
            </button>
          )}
        </div>
        {shownMsg && <p className={`msg ${shownMsg.kind}`}>{shownMsg.text}</p>}
      </section>
    )
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>简历</h2>
          <button className="btn" onClick={() => setShowUpload(true)} disabled={pending}>
            导入新简历
          </button>
        </div>
        {shownMsg && <p className={`msg ${shownMsg.kind}`}>{shownMsg.text}</p>}
        {justImported && (
          <p className="msg ok" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>简历就绪，面试官已能读你的简历针对性出题。</span>
            <button className="btn small primary" onClick={() => navigate('/')}>
              去发起第一场面试 →
            </button>
          </p>
        )}

        {profile.has_pdf ? (
          <div className="pdf-view">
            <div className="btn-row pdf-view-actions">
              <a className="btn link-btn" href={`/api/profile/pdf?v=${profile.id}`} target="_blank" rel="noreferrer">
                在新窗口打开（手机查看用这个）
              </a>
              <span className="muted">原始 PDF，排版与你的简历文件完全一致；面试官与复盘评分直接使用这份简历的全文。</span>
            </div>
            <iframe className="pdf-frame" src={`/api/profile/pdf?v=${profile.id}`} title="简历原版 PDF" />
          </div>
        ) : (
          <div className="pdf-missing">
            <p className="muted">当前档案没有保存原始 PDF（早期导入）。重新导入一次即可同时存档源文件。</p>
            <button className="btn primary" onClick={() => setShowUpload(true)}>
              重新导入简历 PDF
            </button>
          </div>
        )}

        <details className="raw-text">
          <summary>简历全文（{profile.raw_text.length} 字，AI 实际读取的内容）</summary>
          <pre>{profile.raw_text}</pre>
        </details>
      </section>
    </div>
  )
}
