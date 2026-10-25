"""面试模块 API：作答评分（题库续答）/ 真实复盘 / 题库列表。

v2.0：旧的固定题组模拟出题（POST /questions）随 MockPanel 一并移除，
对话式面试官引擎在 v2-2 落地；本文件保留题库续答与真实复盘。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import services.interview as interview_service
import services.interviewer as interviewer
import services.knowledge as knowledge_service
import services.ocr as ocr_service
from deps import get_active_profile, get_db
from models import InterviewCampaign, InterviewQA, InterviewSession, Job, Profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interview", tags=["interview"])


def _job_dict(db: Session, job_id: int | None) -> dict | None:
    if not job_id:
        return None
    job = db.get(Job, job_id)
    if not job:
        return None
    jd = job.jd_parsed_json or {}
    return {
        "id": job.id,
        "company": job.company,
        "title": job.title,
        "direction": job.direction,
        "jd": {"summary": jd.get("summary", ""), "requirements": jd.get("requirements", [])},
        "match": job.match_analysis_json,
    }


def _qa_dict(qa: InterviewQA, db: Session) -> dict:
    fb = qa.feedback_json or {}
    return {
        "id": qa.id,
        "session_id": qa.session_id,
        "session_type": qa.session_type,
        "direction": qa.direction,
        "question_type": qa.question_type,
        "question": qa.question,
        "hint": fb.get("hint") if qa.my_answer is None else None,
        "my_answer": qa.my_answer,
        "score": qa.score,
        "feedback": {k: v for k, v in fb.items() if k != "hint"} if qa.my_answer is not None else None,
        "job": _job_dict(db, qa.job_id),
        "created_at": qa.created_at.isoformat() if qa.created_at else None,
    }


def _context(db: Session, job_id: int | None) -> tuple[dict | None, dict | None]:
    profile = get_active_profile(db)  # 无简历时 404
    return profile.raw_text, _job_dict(db, job_id)


class AnswerBody(BaseModel):
    answer: str


@router.post("/qa/{qa_id}/answer")
def submit_answer(qa_id: int, body: AnswerBody, db: Session = Depends(get_db)):
    """提交模拟面试作答，LLM 评分 + 参考要点 + 改进建议。"""
    qa = db.get(InterviewQA, qa_id)
    if not qa:
        raise HTTPException(404, "题目不存在")
    answer = body.answer.strip()
    if len(answer) < 5:
        raise HTTPException(400, "回答太短，请认真作答后再提交")

    resume_text, job = _context(db, qa.job_id)
    try:
        feedback = interview_service.grade_answer(
            qa.question, qa.question_type, answer, qa.direction, resume_text, job
        )
    except Exception as e:
        raise HTTPException(502, f"评分失败：{e}")

    qa.my_answer = answer
    qa.score = feedback["score"]
    qa.feedback_json = feedback
    db.commit()
    db.refresh(qa)
    return {"item": _qa_dict(qa, db)}


class RealBody(BaseModel):
    question: str
    my_answer: str
    direction: str | None = None
    job_id: int | None = None


@router.post("/real")
def real_review(body: RealBody, db: Session = Depends(get_db)):
    """真实面试复盘：记录被问的问题+当时回答 → AI 分析哪里可以答得更好。"""
    question = body.question.strip()
    answer = body.my_answer.strip()
    if len(question) < 5:
        raise HTTPException(400, "问题太短")
    if len(answer) < 5:
        raise HTTPException(400, "请填写当时的回答（复盘需要对照）；实在没答上可写「当时没答上来」")

    resume_text, job = _context(db, body.job_id)
    try:
        feedback = interview_service.grade_answer(
            question, None, answer, body.direction, resume_text, job, is_real=True
        )
    except Exception as e:
        raise HTTPException(502, f"复盘失败：{e}")

    qa = InterviewQA(
        session_type="real",
        direction=body.direction,
        question=question,
        my_answer=answer,
        score=feedback["score"],
        feedback_json=feedback,
        job_id=body.job_id,
    )
    db.add(qa)
    db.commit()
    db.refresh(qa)
    return {"item": _qa_dict(qa, db)}


@router.get("/qa")
def list_qa(session_type: str | None = None, session_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(InterviewQA)
    if session_type in ("mock", "real"):
        q = q.filter(InterviewQA.session_type == session_type)
    if session_id:
        q = q.filter(InterviewQA.session_id == session_id)
    rows = q.order_by(InterviewQA.id.desc()).limit(500).all()
    return {"items": [_qa_dict(r, db) for r in rows]}


@router.delete("/qa/{qa_id}")
def delete_qa(qa_id: int, db: Session = Depends(get_db)):
    """删除单条题库记录（早期零散题 / 真实复盘 / 已结束会话的题目）。

    进行中会话的题目不提供单条删除——随会话整体删除（DELETE /sessions/{id}）。
    """
    qa = db.get(InterviewQA, qa_id)
    if not qa:
        raise HTTPException(404, "记录不存在")
    if qa.session_id and qa.session_id.isdigit():
        session = db.get(InterviewSession, int(qa.session_id))
        if session and session.status == "running":
            raise HTTPException(400, "进行中的面试题目请随会话整体删除（在「面试」页删除整场会话）")
    db.delete(qa)
    db.commit()
    return {"ok": True}


# ---------- v2-2 对话式面试会话 ----------


def _session_dict(s: InterviewSession) -> dict:
    duration = _engine_duration(s)
    return {
        "id": s.id,
        "direction": s.direction,
        "jd_text": s.jd_text,
        "jd_source": s.jd_source,
        "status": s.status,
        "focused": bool(s.focus_json),  # 4 题短面：专项训练 / 战役轮次
        "focus": s.focus_json,  # {"weak_points":[...]} 或 {"campaign_id":N,"campaign_round":N}
        "weak_points": (s.focus_json or {}).get("weak_points") if s.focus_json else None,
        "duration_min": duration,
        "messages": s.messages_json or [],
        "report": s.report_json,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "finished_at": s.finished_at.isoformat() if s.finished_at else None,
        "state": _session_state_of(s),
    }


def _engine_focus(s: InterviewSession) -> dict | None:
    """会话的专项训练上下文（非专项会话返回 None）。"""
    return s.focus_json or None


def _engine_duration(s: InterviewSession) -> int | None:
    """v2.4 时长档：薄弱项专项不挂时长（None）；其余返回会话 duration_min。"""
    if s.focus_json and s.focus_json.get("weak_points"):
        return None
    return s.duration_min


def _elapsed_min(s: InterviewSession) -> float:
    """已进行分钟数：会话创建时间起算（v2.4 引擎时间预算）。"""
    if not s.created_at:
        return 0.0
    return max(0.0, (datetime.now() - s.created_at).total_seconds() / 60)


def _session_state_of(s: InterviewSession) -> dict:
    duration = _engine_duration(s)
    return interviewer.session_state(
        s.messages_json or [],
        None if s.focus_json else interviewer.MAIN_STRUCTURE,
        duration_min=duration,
        elapsed_min=_elapsed_min(s) if duration is not None else None,
    )


def _finish_session(db: Session, s: InterviewSession, profile: Profile) -> None:
    """生成统一报告、逐题落库 interview_qa、会话标记 done。"""
    report = interviewer.generate_report(
        db, s.direction, s.jd_text, profile.raw_text, s.messages_json or [], focus=_engine_focus(s),
        duration_min=_engine_duration(s), elapsed_min=_elapsed_min(s),
    )
    s.report_json = report
    s.status = "done"
    s.finished_at = datetime.now()
    db.flush()

    pairs = interviewer._qa_pairs(s.messages_json or [])
    items = report.get("items") or []
    for p, it in zip(pairs, items):
        db.add(InterviewQA(
            session_id=str(s.id),
            session_type="mock",
            direction=s.direction,
            question_type=p.get("question_type"),
            question=p["question"],
            my_answer=p.get("answer") or None,
            score=it.get("score"),
            feedback_json={
                "comment": it.get("comment", ""),
                "key_points": it.get("key_points", []),
                "suggestions": it.get("suggestions", []),
            },
        ))
    db.commit()

    # v2.2-2 JD 持续学习：带任意非空 JD 的会话，由 LLM 判断是否有增量价值再合并
    # （≥20字防垃圾；只增不删，失败仅记日志，不阻断报告）
    jd = (s.jd_text or "").strip()
    if len(jd) >= 20:
        try:
            added = knowledge_service.merge_knowledge(db, s.direction, jd)
            if added:
                logger.info("知识库增量合并 direction=%s +%d条", s.direction, added)
        except Exception as e:
            logger.warning("知识库合并失败（不影响报告）: %s", e)


@router.post("/jd_ocr")
def jd_ocr(files: list[UploadFile] = File(...)):
    """JD 截图 → 多模态 OCR → 文字 JD（结果由前端填入可编辑文本框，用户确认后随会话提交）。"""
    try:
        images = ocr_service.load_images(files)
    except ocr_service.OcrInputError as e:
        raise HTTPException(400, str(e))
    try:
        text = ocr_service.ocr_images(images)
    except Exception as e:
        raise HTTPException(502, f"JD 识别失败：{e}")
    return {"text": text}


class SessionCreateBody(BaseModel):
    direction: str
    jd_text: str | None = None
    jd_source: str | None = None  # text | ocr（v2.1-3）
    # v2.3-2 薄弱项专项训练：非空时建 4 题专项会话（围绕薄弱项出题）
    weak_points: list[str] | None = None
    # v2.3-3 面试战役轮次会话：非空时按战役轮次出题并挂到战役
    campaign_id: int | None = None
    campaign_round: int | None = None
    # v2.4 时长档：25（默认）| 40（深挖）；战役轮次忽略此值固定默认档；专项忽略
    duration_min: int | None = None


DURATION_CHOICES = (25, 40)


def _create_session_row(db: Session, body: SessionCreateBody) -> InterviewSession:
    """建会话公共逻辑：普通 / 专项（weak_points）/ 战役轮次（campaign_round）+ 时长档。"""
    jd_text = (body.jd_text or "").strip()
    jd_source = body.jd_source if jd_text and body.jd_source in ("text", "ocr") else ("text" if jd_text else None)
    weak = [str(w).strip() for w in (body.weak_points or []) if str(w).strip()]
    focus = None
    if body.campaign_round and 1 <= int(body.campaign_round) <= 3:
        focus = {"campaign_id": body.campaign_id, "campaign_round": int(body.campaign_round)}
    elif weak:
        focus = {"weak_points": weak}
    # 时长档：非法值忽略；战役轮次固定默认档 25；薄弱项专项不挂时长
    duration = body.duration_min if body.duration_min in DURATION_CHOICES else None
    if focus and focus.get("campaign_round"):
        duration = DURATION_CHOICES[0]
    elif focus and focus.get("weak_points"):
        duration = None
    s = InterviewSession(
        direction=body.direction.strip(),
        jd_text=jd_text or None,
        jd_source=jd_source,
        focus_json=focus,
        duration_min=duration,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    # 战役轮次会话：挂进战役的 session_ids（幂等）
    if focus and focus.get("campaign_id"):
        camp = db.get(InterviewCampaign, focus["campaign_id"])
        if camp and camp.status == "running" and s.id not in (camp.session_ids or []):
            camp.session_ids = [*(camp.session_ids or []), s.id]
            db.commit()
    return s


@router.post("/sessions")
def create_session(body: SessionCreateBody, db: Session = Depends(get_db)):
    """新建面试会话：首条消息 = 面试官开场 + 第 1 题（自我介绍；专项训练为针对性开场）。"""
    if not (body.direction or "").strip():
        raise HTTPException(400, "请填写面试方向")
    profile = get_active_profile(db)  # 无简历时 404
    s = _create_session_row(db, body)
    try:
        turn = interviewer.next_turn(db, s.direction, s.jd_text, profile.raw_text, [], focus=_engine_focus(s),
                                        duration_min=_engine_duration(s), elapsed_min=_elapsed_min(s))
    except Exception as e:
        db.delete(s)
        db.commit()
        raise HTTPException(502, f"面试官启动失败：{e}")
    s.messages_json = [{"role": "interviewer", "text": turn["say"], "meta": {
        "action": turn["action"], "question_type": turn["question_type"], "is_main_question": turn["is_main_question"]}}]
    db.commit()
    db.refresh(s)
    return {"session": _session_dict(s)}


@router.get("/sessions")
def list_sessions(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(InterviewSession)
    if status in ("running", "done"):
        q = q.filter(InterviewSession.status == status)
    rows = q.order_by(InterviewSession.id.desc()).limit(100).all()
    return {"sessions": [
        {
            **{k: v for k, v in _session_dict(s).items() if k not in ("messages", "report")},
            "summary": _session_summary(s.report_json),
        }
        for s in rows
    ]}


def _session_summary(report: dict | None) -> dict:
    """从报告提取轻量摘要：均分 / 题数 / 薄弱项 / 五维（v2.3-2 雷达对比用）。"""
    if not report:
        return {"avg": None, "count": 0, "weaknesses": [], "dimensions": None}
    items = report.get("items") or []
    scores = [it.get("score") for it in items if isinstance(it.get("score"), (int, float))]
    dims = report.get("dimensions")
    return {
        "avg": round(sum(scores) / len(scores), 1) if scores else None,
        "count": len(items),
        "weaknesses": [str(w) for w in (report.get("weaknesses") or [])][:6],
        "dimensions": {str(k): v for k, v in dims.items()} if isinstance(dims, dict) else None,
    }


@router.get("/stats")
def practice_stats(db: Session = Depends(get_db)):
    """练习统计：场次 / 总均分 / 题型薄弱排序 / 最近趋势 / 薄弱项池。"""
    rows = db.query(InterviewSession).order_by(InterviewSession.id.asc()).all()
    done = [s for s in rows if s.status == "done" and s.report_json]
    items_all = [it for s in done for it in (s.report_json.get("items") or [])]
    scores = [it.get("score") for it in items_all if isinstance(it.get("score"), (int, float))]

    type_agg: dict[str, list[float]] = {}
    for it in items_all:
        sc = it.get("score")
        if isinstance(sc, (int, float)):
            t = str(it.get("question_type") or "未分类")
            type_agg.setdefault(t, []).append(sc)

    return {
        "total_sessions": len(rows),
        "done_sessions": len(done),
        "total_items": len(items_all),
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "type_stats": [
            {"type": t, "avg": round(sum(v) / len(v), 1), "count": len(v)}
            for t, v in sorted(type_agg.items(), key=lambda kv: sum(kv[1]) / len(kv[1]))
        ],
        "trend": [
            {
                "id": s.id,
                "direction": s.direction,
                "date": (s.finished_at or s.created_at or "").isoformat() if hasattr(s.finished_at or s.created_at, "isoformat") else None,
                "avg": _session_summary(s.report_json)["avg"],
            }
            for s in done
        ][-12:],
        "recent_weaknesses": [str(w) for s in done[-8:] for w in (s.report_json.get("weaknesses") or [])][:24],
    }


@router.get("/sessions/{sid}")
def get_session(sid: int, db: Session = Depends(get_db)):
    s = db.get(InterviewSession, sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    return {"session": _session_dict(s)}


def _sse_event(obj: dict) -> str:
    """SSE 帧：data: {json}\\n\\n（v2.3-1 面试官流式输出）。"""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class SessionAnswerBody(BaseModel):
    text: str
    # v2.3-1 前端本地语音统计（语速/填充词/句完整度），随候选人消息存入 meta，报告"表达"维度用
    speech: dict | None = None


@router.post("/sessions/{sid}/answer")
def session_answer(sid: int, body: SessionAnswerBody, db: Session = Depends(get_db)):
    """候选人作答 → 面试官下一句；面试官说收尾（end）时自动结束并生成报告。"""
    s = db.get(InterviewSession, sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    if s.status != "running":
        raise HTTPException(400, "会话已结束")
    text = body.text.strip()
    if len(text) < 5:
        raise HTTPException(400, "回答太短，请像面试口述一样作答")
    profile = get_active_profile(db)

    messages = list(s.messages_json or [])
    messages.append({"role": "candidate", "text": text, "meta": {"speech": body.speech} if body.speech else {}})
    try:
        turn = interviewer.next_turn(db, s.direction, s.jd_text, profile.raw_text, messages, focus=_engine_focus(s),
                                          duration_min=_engine_duration(s), elapsed_min=_elapsed_min(s))
    except Exception as e:
        raise HTTPException(502, f"面试官响应失败：{e}")
    messages.append({"role": "interviewer", "text": turn["say"], "meta": {
        "action": turn["action"], "question_type": turn["question_type"], "is_main_question": turn["is_main_question"]}})
    s.messages_json = messages
    db.commit()

    if turn["action"] == "end":
        try:
            _finish_session(db, s, profile)
        except Exception as e:
            db.rollback()  # 对话已保存；报告失败可再点「结束面试」重试
            raise HTTPException(502, f"面试已到收尾，但报告生成失败：{e}。请点「结束面试」重试")
    db.refresh(s)
    return {"session": _session_dict(s)}


@router.post("/sessions/stream")
def create_session_stream(body: SessionCreateBody, db: Session = Depends(get_db)):
    """SSE 流式建会话（v2.3-1）：meta → delta* → done(session)。
    启动失败（含流式格式连续违规）发 error 事件并删除半建会话，前端降级整体接口。"""
    if not (body.direction or "").strip():
        raise HTTPException(400, "请填写面试方向")
    profile = get_active_profile(db)
    s = _create_session_row(db, body)

    def gen():
        turn = None
        try:
            for kind, payload in interviewer.next_turn_stream(
                db, s.direction, s.jd_text, profile.raw_text, [], focus=_engine_focus(s),
                duration_min=_engine_duration(s), elapsed_min=_elapsed_min(s),
            ):
                if kind == "delta":
                    yield _sse_event({"type": "delta", "text": payload})
                elif kind == "meta":
                    yield _sse_event({"type": "meta", "session_id": s.id, "turn_meta": payload})
                else:
                    turn = payload
            s.messages_json = [{"role": "interviewer", "text": turn["say"], "meta": {
                "action": turn["action"], "question_type": turn["question_type"],
                "is_main_question": turn["is_main_question"]}}]
            db.commit()
            db.refresh(s)
            yield _sse_event({"type": "done", "session": _session_dict(s)})
        except Exception as e:
            db.rollback()
            db.query(InterviewSession).filter(InterviewSession.id == s.id).delete()
            db.commit()
            logger.warning("流式建会话失败 session=%s: %s", s.id, e)
            yield _sse_event({"type": "error", "message": f"面试官启动失败：{e}"})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/sessions/{sid}/answer/stream")
def session_answer_stream(sid: int, body: SessionAnswerBody, db: Session = Depends(get_db)):
    """SSE 流式作答（v2.3-1）：meta → delta* → [status:report] → done(session)。
    生成失败发 error 事件且不落库（前端可安全降级/重试，不会重复计入回答）。"""
    s = db.get(InterviewSession, sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    if s.status != "running":
        raise HTTPException(400, "会话已结束")
    text = body.text.strip()
    if len(text) < 5:
        raise HTTPException(400, "回答太短，请像面试口述一样作答")
    profile = get_active_profile(db)

    def gen():
        messages = list(s.messages_json or [])
        messages.append({"role": "candidate", "text": text, "meta": {"speech": body.speech} if body.speech else {}})
        turn = None
        try:
            for kind, payload in interviewer.next_turn_stream(
                db, s.direction, s.jd_text, profile.raw_text, messages, focus=_engine_focus(s),
                duration_min=_engine_duration(s), elapsed_min=_elapsed_min(s),
            ):
                if kind == "delta":
                    yield _sse_event({"type": "delta", "text": payload})
                elif kind == "meta":
                    yield _sse_event({"type": "meta", "turn_meta": payload})
                else:
                    turn = payload
        except Exception as e:
            logger.warning("流式作答失败 session=%s: %s", sid, e)
            yield _sse_event({"type": "error", "message": f"面试官响应失败：{e}"})
            return
        messages.append({"role": "interviewer", "text": turn["say"], "meta": {
            "action": turn["action"], "question_type": turn["question_type"],
            "is_main_question": turn["is_main_question"]}})
        s.messages_json = messages
        db.commit()
        if turn["action"] == "end":
            yield _sse_event({"type": "status", "stage": "report", "message": "面试收尾完成，报告生成中（约30-90秒，请勿关闭页面）…"})
            try:
                _finish_session(db, s, profile)
            except Exception as e:
                db.rollback()
                logger.warning("流式作答后报告生成失败 session=%s: %s", sid, e)
                yield _sse_event({"type": "error", "message": f"对话已保存，但报告生成失败：{e}。请点「结束面试」重试"})
                return
        db.refresh(s)
        yield _sse_event({"type": "done", "session": _session_dict(s)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/sessions/{sid}/end")
def session_end(sid: int, db: Session = Depends(get_db)):
    """用户主动结束：直接生成统一报告并落库。"""
    s = db.get(InterviewSession, sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    if s.status != "running":
        raise HTTPException(400, "会话已结束")
    profile = get_active_profile(db)
    try:
        _finish_session(db, s, profile)
    except Exception as e:
        db.rollback()
        raise HTTPException(502, f"报告生成失败：{e}")
    db.refresh(s)
    return {"session": _session_dict(s)}


@router.delete("/sessions/{sid}")
def delete_session(sid: int, db: Session = Depends(get_db)):
    s = db.get(InterviewSession, sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    db.query(InterviewQA).filter(InterviewQA.session_id == str(sid)).delete()
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------- v2.3-3 面试战役（三轮递进 + 综合评估） ----------

ROUND_NAMES = [r["name"] for r in interviewer.CAMPAIGN_ROUNDS]


class CampaignCreateBody(BaseModel):
    direction: str
    jd_text: str | None = None
    jd_source: str | None = None


def _campaign_dict(db: Session, c: InterviewCampaign, with_reports: bool = False) -> dict:
    rounds = []
    for i, sid in enumerate(c.session_ids or []):
        s = db.get(InterviewSession, sid)
        if not s:
            continue
        summary = _session_summary(s.report_json)
        item = {
            "round": i + 1,
            "name": ROUND_NAMES[i] if i < len(ROUND_NAMES) else f"第{i + 1}轮",
            "session_id": s.id,
            "status": s.status,
            "avg": summary["avg"],
            "dimensions": summary["dimensions"],
            "weaknesses": summary["weaknesses"],
        }
        if with_reports:
            item["report"] = s.report_json
        rounds.append(item)
    return {
        "id": c.id,
        "direction": c.direction,
        "jd_text": c.jd_text,
        "status": c.status,
        "current_round": c.current_round,
        "total_rounds": 3,
        "round_names": ROUND_NAMES,
        # 进行中的战役：下一轮轮次号（前端据此发 /sessions/stream campaign_round）
        "next_round": (c.current_round + 1) if c.status == "running" and c.current_round < 3 else None,
        "rounds": rounds,
        "verdict": c.verdict_json,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "finished_at": c.finished_at.isoformat() if c.finished_at else None,
    }


@router.post("/campaigns")
def create_campaign(body: CampaignCreateBody, db: Session = Depends(get_db)):
    """发起面试战役：创建战役壳，第 1 轮会话由前端走 /sessions/stream（campaign_id+round）流式开启。"""
    if not (body.direction or "").strip():
        raise HTTPException(400, "请填写面试方向")
    get_active_profile(db)  # 无简历时 404
    jd_text = (body.jd_text or "").strip()
    c = InterviewCampaign(direction=body.direction.strip(), jd_text=jd_text or None)
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"campaign": _campaign_dict(db, c)}


@router.get("/campaigns")
def list_campaigns(db: Session = Depends(get_db)):
    rows = db.query(InterviewCampaign).order_by(InterviewCampaign.id.desc()).limit(50).all()
    return {"campaigns": [_campaign_dict(db, c) for c in rows]}


@router.get("/campaigns/{cid}")
def get_campaign(cid: int, db: Session = Depends(get_db)):
    c = db.get(InterviewCampaign, cid)
    if not c:
        raise HTTPException(404, "战役不存在")
    return {"campaign": _campaign_dict(db, c, with_reports=True)}


class CampaignAdvanceBody(BaseModel):
    session_id: int


@router.post("/campaigns/{cid}/advance")
def campaign_advance(cid: int, body: CampaignAdvanceBody, db: Session = Depends(get_db)):
    """一轮完成登记：校验轮次会话归属与状态 → 推进轮次；三轮齐则生成综合评估。

    幂等设计：重复 advance 已计过的轮次不报错；评估生成失败后重试同一轮即可补生成。
    """
    c = db.get(InterviewCampaign, cid)
    if not c:
        raise HTTPException(404, "战役不存在")
    if c.status == "done" and c.verdict_json:
        return {"campaign": _campaign_dict(db, c, with_reports=True)}
    s = db.get(InterviewSession, body.session_id)
    if not s:
        raise HTTPException(404, "会话不存在")
    ids = c.session_ids or []
    if s.id not in ids:
        raise HTTPException(400, "该会话不属于这场战役")
    if s.status != "done" or not s.report_json:
        raise HTTPException(400, "本轮面试尚未完成（需先出报告）")
    round_no = ids.index(s.id) + 1
    if round_no > 3:
        raise HTTPException(400, "战役只有 3 轮")
    if round_no > c.current_round:
        c.current_round = round_no

    if c.current_round >= 3 and not c.verdict_json:
        rounds = []
        for i, sid in enumerate(ids):
            rs = db.get(InterviewSession, sid)
            if rs and rs.report_json:
                rounds.append({"name": ROUND_NAMES[i] if i < len(ROUND_NAMES) else f"第{i + 1}轮",
                               "avg": _session_summary(rs.report_json)["avg"], "report": rs.report_json})
        try:
            c.verdict_json = interviewer.generate_campaign_verdict(c.direction, c.jd_text, rounds)
        except Exception as e:
            db.commit()  # 轮次推进先落库，评估失败可重试（再调一次 advance）
            logger.warning("战役综合评估生成失败 campaign=%s: %s", cid, e)
            raise HTTPException(502, f"三轮已齐，但综合评估生成失败：{e}。请稍后重试")
        c.status = "done"
        c.finished_at = datetime.now()
    db.commit()
    db.refresh(c)
    return {"campaign": _campaign_dict(db, c, with_reports=True)}


@router.delete("/campaigns/{cid}")
def delete_campaign(cid: int, db: Session = Depends(get_db)):
    """删除战役（三轮会话与题库记录保留，仍在面试历史里）。"""
    c = db.get(InterviewCampaign, cid)
    if not c:
        raise HTTPException(404, "战役不存在")
    db.delete(c)
    db.commit()
    return {"ok": True}
