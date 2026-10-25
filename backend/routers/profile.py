"""简历档案 API（v2.1-1 去结构化）：源文件即真相。

导入只存两样东西：原始 PDF（原版预览）+ pypdf 提取的全文（面试引擎/复盘评分直接用全文）。
结构化视图、编辑、reparse 已删除；profile.structured_json 列停用保留。
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import services.profile as profile_service
from deps import get_db
from models import Profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profile", tags=["profile"])

PDF_DIR = Path(__file__).resolve().parent.parent / "data" / "resume_pdfs"


def _active_profile(db: Session) -> Profile | None:
    return (
        db.query(Profile)
        .filter(Profile.is_active == True)  # noqa: E712
        .order_by(Profile.id.desc())
        .first()
    )


def _profile_dict(p: Profile) -> dict:
    return {
        "id": p.id,
        "version": p.version,
        "raw_text": p.raw_text,
        "has_pdf": bool(p.pdf_path and Path(p.pdf_path).is_file()),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.post("/import")
def import_profile(
    file: UploadFile = File(...), db: Session = Depends(get_db)
):
    """导入 PDF：提取全文落库 + 存档源文件。零 LLM 调用，导入即完成。"""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "只支持 PDF 简历")
    pdf_bytes = file.file.read()
    try:
        text = profile_service.extract_pdf_text(pdf_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))

    db.query(Profile).filter(Profile.is_active == True).update({"is_active": False})  # noqa: E712
    prof = Profile(raw_text=text, is_active=True)
    db.add(prof)
    db.commit()
    db.refresh(prof)

    # 原始 PDF 存档：保留用户原排版，供前端原样预览
    try:
        PDF_DIR.mkdir(parents=True, exist_ok=True)
        pdf_file = PDF_DIR / f"resume_{prof.id}.pdf"
        pdf_file.write_bytes(pdf_bytes)
        prof.pdf_path = str(pdf_file)
        db.commit()
    except OSError as e:
        logger.warning("简历 PDF 存档失败（不影响文本导入）: %s", e)
    return {"profile": _profile_dict(prof)}


@router.get("")
def get_profile(response: Response, db: Session = Depends(get_db)):
    # v1.3：禁止浏览器缓存，导入新简历后立即看到新档案
    response.headers["Cache-Control"] = "no-store"
    p = _active_profile(db)
    return {"profile": _profile_dict(p) if p else None}


@router.get("/pdf")
def get_profile_pdf(db: Session = Depends(get_db)):
    """当前简历的原始 PDF（浏览器内联预览 / 手机上新窗口打开）。"""
    p = _active_profile(db)
    if not p or not p.pdf_path:
        raise HTTPException(404, "当前简历档案没有保存原始 PDF，请重新导入一次简历")
    path = Path(p.pdf_path)
    if not path.is_file():
        raise HTTPException(404, "原始 PDF 文件已丢失，请重新导入简历")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename="简历.pdf",
        content_disposition_type="inline",
        headers={"Cache-Control": "no-store"},  # v1.3：同URL不缓存，配合前端 ?v= 双保险
    )
