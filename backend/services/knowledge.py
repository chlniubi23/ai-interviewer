"""岗位知识库（v2.1-2 通用化 / v2.2-2 广度扩展 + JD 持续学习）。

两个来源（红线：产品运行期不联网抓取招聘网站，画像由 LLM 基于自身知识生成）：
- 调研文件（开发期行为）：backend/data/knowledge/{direction}.md —— 启动时同步进
  knowledge 表（source=researched，文件为真相每次刷新；覆盖前保留运行期学到的增量小节）
- 运行时画像：用户填写调研未覆盖的方向时，LLM 即时生成「岗位画像」存表
  （source=generated），同方向复用不再重复生成

JD 持续学习（v2.2-2）：带 JD（≥200 字）的会话结束后，merge_knowledge 提取
JD 中现有知识未覆盖的增量，只增不删追加到「市场增量（自动学习）」小节。

注入规则（沿用）：JD ≥200 字 → JD 为主、知识库/画像补充深挖；
JD 为空或过短 → 知识库/画像成为出题主依据。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from sqlalchemy.orm import Session

import llm
from models import Knowledge

logger = logging.getLogger(__name__)

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "data" / "knowledge"

JD_FULL_THRESHOLD = 200  # JD 达到该长度视为"存在"，以 JD 为主
JD_MAX_CHARS = 2000  # JD 截断，控制 token
PROFILE_MAX_CHARS = 6000  # 生成画像长度保护

LEARNED_SECTION = "## 市场增量（自动学习）"
_LEARNED_RE = re.compile(r"\n*(" + re.escape(LEARNED_SECTION) + r".*)\s*$", re.DOTALL)

PROFILE_PROMPT = """你是资深的行业研究与技术面试专家。请为面试方向「{direction}」写一份简明的「岗位画像」，用作 AI 模拟面试的出题参考。

要求：
- 基于你对真实就业市场的认知撰写；不确定的写普遍情况即可，不要编造具体公司名
- 结构固定为四节：## 典型岗位职责 / ## 常见硬性要求 / ## 高频技能栈 / ## 面试高频考察点
- 总长度 900-1400 字，条目式，高频项标注（高频）
- 面试高频考察点要具体到面试官真会问的问题（概念/场景/手撕），不要空话
- 用中文输出 Markdown，不要输出其他说明文字"""


def _split_learned(content: str) -> tuple[str, str]:
    """分离正文与运行期学习到的增量小节（文件刷新时保留学习成果）。"""
    m = _LEARNED_RE.search(content or "")
    if not m:
        return (content or "").strip(), ""
    return (content[: m.start()]).strip(), m.group(1).strip()


def seed_researched(db: Session) -> None:
    """启动时把调研文件同步进 knowledge 表（source=researched，文件覆盖刷新；
    覆盖前保留运行期 JD 持续学习累积的「市场增量」小节）。"""
    if not KNOWLEDGE_DIR.is_dir():
        return
    for path in KNOWLEDGE_DIR.glob("*.md"):
        direction = path.stem.strip()
        try:
            content = path.read_text(encoding="utf-8").strip()
        except OSError as e:
            logger.warning("调研文件读取失败 %s: %s", path.name, e)
            continue
        if not direction or not content:
            continue
        row = db.get(Knowledge, direction)
        _, learned = _split_learned(row.content) if row else ("", "")
        merged = content + (f"\n\n{learned}" if learned else "")
        if row:
            row.content = merged
            row.source = "researched"
        else:
            db.add(Knowledge(direction=direction, content=merged, source="researched"))
    db.commit()


def _generate_profile(direction: str) -> str:
    text = llm.chat_text(
        PROFILE_PROMPT.format(direction=direction),
        model=llm.MODEL,
        temperature=0.4,
    )
    return text.strip()[:PROFILE_MAX_CHARS]


def get_knowledge(db: Session, direction: str) -> str:
    """取方向知识（researched 或 generated）；未覆盖且非空方向即时生成并缓存。

    生成失败时返回空串降级（面试按通用标准进行，下次再试）。
    """
    direction = (direction or "").strip()
    if not direction:
        return ""
    row = db.get(Knowledge, direction)
    if row:
        return row.content
    logger.info("方向「%s」无调研知识，生成岗位画像…", direction)
    try:
        content = _generate_profile(direction)
    except Exception as e:
        logger.warning("岗位画像生成失败 direction=%s: %s", direction, e)
        return ""
    if not content:
        return ""
    db.add(Knowledge(direction=direction, content=content, source="generated"))
    db.commit()
    return content


def knowledge_context(db: Session, direction: str | None, jd_text: str | None) -> str:
    """组装出题上下文（面试官 system prompt 的一部分）。"""
    direction = (direction or "").strip()
    jd = (jd_text or "").strip()
    knowledge = get_knowledge(db, direction) if direction else ""

    parts: list[str] = []
    if len(jd) >= JD_FULL_THRESHOLD:
        parts.append(f"【目标岗位 JD（出题主依据）】\n{jd[:JD_MAX_CHARS]}")
        if knowledge:
            parts.append(f"【{direction} 方向市场知识库（补充深挖与考察点参考）】\n{knowledge}")
    else:
        if knowledge:
            parts.append(f"【{direction} 方向市场知识库（JD 缺失，出题主依据）】\n{knowledge}")
        if jd:
            parts.append(f"【候选人提供的简要岗位信息】\n{jd}")
        elif not knowledge:
            parts.append("（无 JD 且无该方向知识库：按通用面试标准出题）")
    return "\n\n".join(parts)


MERGE_SCHEMA_HINT = """
{
  "increments": ["新发现的市场信号条目，每条一句话，具体可考"]
}
"""

MERGE_PROMPT = """你是岗位市场研究分析师。下面是「{direction}」方向的现有知识库内容，以及一场真实模拟面试使用的目标岗位 JD。请对比二者，仅提取 JD 中**现有知识未覆盖、且对模拟面试有自进化价值**的增量信息。
判断标准（严格执行）：一条信息值得学习，当且仅当它能改变面试官该问什么或考察什么——即新的职责类型、新的硬技能/工具/框架、新的业务场景知识、新的考察点。
以下内容一律**不提取**（对面试无增量价值）：
- 出勤/实习天数、排班、坐班要求等事务性条件
- 薪资福利、学历门槛、招聘人数、截止日期、简历语言
- "认真负责/团队协作/抗压/沟通能力强"等通用素质描述
- 仅代表单一公司特殊业务线、不具备市场普遍性的内容
- 现有内容（含"市场增量"小节）已有的信息

规则：
- 只增不删：不评价、不改写、不删除现有内容
- 每条一句话、具体可考（如"要求熟悉 NetSuite 跨境财务系统"）
- 拿不准某条是否有价值时，不提取
- 若无任何有价值的增量，输出空数组

【现有知识库内容】
{content}

【目标岗位 JD】
{jd}

输出 JSON：{schema}"""


# v2.6-3 膨胀治理：知识库单方向过长时先蒸馏再合并（防「市场增量」小节无限增长）
DISTILL_THRESHOLD = 8000
DISTILL_TARGET = 4000

DISTILL_PROMPT = """你是岗位知识库编辑。「{direction}」方向的知识库内容已膨胀到 {n} 字，请压缩到约 {target} 字。

压缩规则（严格执行）：
- 保留全部小节标题结构（##/### 开头），不得合并或删除小节
- 「市场增量（自动学习）」小节的条目必须逐条保留——可精炼措辞，不可丢弃任何一条已学习信号
- 调研/画像正文保留全部关键信号（技能/工具/职责/考察点/岗位形态甄别结论），合并同类项、删冗余展开与重复例证
- 保持原有的条目化风格（- 开头），不要改成大段散文
- 只输出压缩后的完整知识库正文，不要任何解释或代码块标记

【待压缩内容】
{content}"""


def _distill_if_needed(db: Session, direction: str, row: Knowledge) -> None:
    """content 超过阈值时 LLM 蒸馏压缩（独立落库，失败跳过不阻断后续合并）。"""
    if len(row.content) <= DISTILL_THRESHOLD:
        return
    try:
        distilled = llm.chat_text(
            DISTILL_PROMPT.format(
                direction=direction, n=len(row.content), target=DISTILL_TARGET, content=row.content
            ),
            model=llm.MODEL,
            temperature=0.2,
        ).strip()
        # 有效性校验：长度落位 + 小节结构保留，不达标宁可不动
        if len(distilled) < 1500 or len(distilled) >= DISTILL_THRESHOLD:
            logger.warning(
                "知识库蒸馏长度异常（%d→%d），放弃采用 direction=%s", len(row.content), len(distilled), direction
            )
            return
        if distilled.count("##") < 2:
            logger.warning("知识库蒸馏丢失小节结构，放弃采用 direction=%s", direction)
            return
        before = len(row.content)
        row.content = distilled
        db.commit()
        logger.info("知识库蒸馏完成 direction=%s：%d → %d 字", direction, before, len(distilled))
    except Exception as e:
        logger.warning("知识库蒸馏失败（跳过，直接合并）direction=%s: %s", direction, e)


def merge_knowledge(db: Session, direction: str, jd_text: str) -> int:
    """带任意非空 JD 的会话结束后，由 LLM 判断该 JD 是否有增量价值，有则合并。

    只增不删（追加到「市场增量（自动学习）」小节）；行级包含去重防重复追加；
    失败抛异常由调用方记日志，不阻断报告。返回实际新增条数。
    """
    direction = (direction or "").strip()
    jd = (jd_text or "").strip()
    if not direction or len(jd) < 20:  # 仅防垃圾输入；是否有学习价值由 LLM 判断（2026-10-15 用户修订：取消 200 字门槛）
        return 0
    row = db.get(Knowledge, direction)
    if not row:
        return 0

    # v2.6-3：先蒸馏再合并——后续 LLM 对比与追加都基于压缩后的内容
    _distill_if_needed(db, direction, row)

    result = llm.chat_json(
        MERGE_PROMPT.format(
            direction=direction, content=row.content, jd=jd[:JD_MAX_CHARS], schema=MERGE_SCHEMA_HINT
        ),
        model=llm.MODEL,
        temperature=0.2,
        schema_hint=MERGE_SCHEMA_HINT,
    )
    raw = result.get("increments")
    if not isinstance(raw, list):
        return 0

    existing_lines = {ln.strip() for ln in row.content.splitlines() if ln.strip()}
    new_items: list[str] = []
    for it in raw:
        s = str(it).strip().lstrip("-•").strip()
        if len(s) < 6:
            continue
        if s in existing_lines:
            continue
        if any(s in ln or ln in s for ln in existing_lines):
            continue  # 行级包含去重：重复同类 JD 不产生重复条目
        new_items.append(s)
        existing_lines.add(s)
    if not new_items:
        return 0

    body, learned = _split_learned(row.content)
    merged_learned = (learned + "\n" if learned else LEARNED_SECTION + "\n") + "\n".join(
        f"- {x}" for x in new_items
    )
    row.content = body + f"\n\n{merged_learned}"
    db.commit()
    return len(new_items)
