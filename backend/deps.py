"""FastAPI 公共依赖。"""
from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from models import Profile, SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_active_profile(db: Session) -> Profile:
    p = (
        db.query(Profile)
        .filter(Profile.is_active == True)  # noqa: E712
        .order_by(Profile.id.desc())
        .first()
    )
    if not p:
        raise HTTPException(404, "尚无简历档案，请先在「简历」页导入")
    return p
