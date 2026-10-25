"""面试模块：作答评分与真实面试复盘（v2.0）。

评分是质量敏感任务，用旗舰档。旧的固定题组出题已随 v1 模拟面试面板移除，
对话式出题/追问在 v2-2 的会话引擎中实现。
"""
from __future__ import annotations

import logging

import llm

logger = logging.getLogger(__name__)

GRADE_SCHEMA_HINT = """
{
  "score": 0,
  "comment": "总体评价1-2句",
  "key_points": ["参考要点"],
  "suggestions": ["针对性改进建议"]
}
"""


RESUME_MAX_CHARS = 8000  # 超长简历截断保护（正常简历约 2-3k 字）


def _resume_context(resume_text: str | None) -> str:
    """v2.1-1：简历全文直接注入（结构化已删），面试引擎与复盘评分共用。"""
    text = (resume_text or "").strip()
    if not text:
        return "（候选人尚未导入简历）"
    return text[:RESUME_MAX_CHARS]


def _job_context(job: dict | None) -> str:
    if not job:
        return ""
    parts = [f"目标岗位：{job.get('company', '')} · {job.get('title', '')}（{job.get('direction', '')}）"]
    jd = job.get("jd") or {}
    if jd.get("summary"):
        parts.append(f"岗位摘要：{jd['summary']}")
    match = job.get("match") or {}
    if match.get("gaps"):
        parts.append("面试官可能针对的缺口：" + "；".join(match["gaps"][:3]))
    return "\n".join(parts)


def _grade_prompt(
    question: str,
    question_type: str | None,
    answer: str,
    direction: str,
    resume_text: str | None,
    job: dict | None,
    is_real: bool,
) -> str:
    task = (
        "候选人记录了真实面试中被问到的问题和当时的回答，请复盘：评估当时的表现，并给出明显更好的答法。"
        if is_real
        else "候选人在模拟面试中作答，请按面试官标准评分。"
    )
    return f"""你是资深AI方向面试官。{task}

面试题（环节：{question_type or "未分类"}）：
{question}

候选人回答：
{answer}

{_job_context(job)}

候选人简历要点（评分时判断回答是否用好了这些素材）：
{_resume_context(resume_text)}

评分锚点：8-10 答到点上且有亮点或有数据支撑；5-7 基本正确但平淡、有遗漏；<5 偏题、空洞或有硬伤。
要求：
- comment 用面试官口吻给总体评价
- key_points 是这道题的参考答案要点（3-6条）
- suggestions 必须具体到"怎么答更好"，可以指出简历里本可引用但没用的素材
- 方向：{direction}
"""


def grade_answer(
    question: str,
    question_type: str | None,
    answer: str,
    direction: str | None,
    resume_text: str | None,
    job: dict | None,
    is_real: bool = False,
) -> dict:
    """评分/复盘，返回 {score, comment, key_points, suggestions}。"""
    result = llm.chat_json(
        _grade_prompt(
            question, question_type, answer, direction or "AI方向", resume_text, job, is_real
        ),
        model=llm.MODEL,
        temperature=0.3,
        schema_hint=GRADE_SCHEMA_HINT,
    )
    try:
        result["score"] = max(0, min(10, int(round(float(result.get("score", 0))))))
    except (TypeError, ValueError):
        result["score"] = 0
    for k in ("key_points", "suggestions"):
        if not isinstance(result.get(k), list):
            result[k] = []
    result["comment"] = str(result.get("comment", "")).strip()
    return result
