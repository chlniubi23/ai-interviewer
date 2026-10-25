/** 与后端 profile 结构化 JSON 对应的类型（LLM 输出经 normalize 后保证字段齐全）。 */

export const DIRECTIONS = ['AI产品', 'FDE', 'AI开发', 'AI测试运维', '全栈', '其他'] as const

export interface ProfileDTO {
  id: number
  version: string
  raw_text: string
  has_pdf: boolean
  created_at: string | null
}
