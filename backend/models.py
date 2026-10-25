"""SQLAlchemy 数据模型 — 对应 PLAN §5。

漏斗统计一律从 status_event 事件表算，不从 job 当前状态算。
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    sessionmaker,
)

# v2.6-2 冷启动/测试：APP_DATA_DIR 环境变量可把主库指到独立目录（默认 backend/data）
DB_PATH = Path(os.getenv("APP_DATA_DIR", Path(__file__).resolve().parent / "data")) / "app.db"
DB_PATH.parent.mkdir(exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# 状态流（PLAN §4-5）
STATUS_PENDING = "待投"
STATUS_GREETED = "已打招呼"
STATUS_REPLIED = "已回复"
STATUS_INTERVIEW_SCHEDULING = "约面"
STATUS_INTERVIEWING = "面试中"
STATUS_OFFER = "Offer"
STATUS_TERMINATED = "终止"

DIRECTIONS = ["AI产品", "FDE", "AI开发", "AI测试运维", "全栈", "其他"]
VERDICTS = ["投", "缓", "弃"]
GREETING_VERSIONS = ["稳健版", "亮点版", "简洁版"]
JOB_STATUSES = [
    STATUS_PENDING,
    STATUS_GREETED,
    STATUS_REPLIED,
    STATUS_INTERVIEW_SCHEDULING,
    STATUS_INTERVIEWING,
    STATUS_OFFER,
    STATUS_TERMINATED,
]


class Base(DeclarativeBase):
    pass


class Profile(Base):
    __tablename__ = "profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String(50), default="v1")
    raw_text: Mapped[str] = mapped_column(Text)
    structured_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)  # 原始 PDF 存档路径
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Job(Base):
    __tablename__ = "job"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(200))
    direction: Mapped[str | None] = mapped_column(String(50), nullable=True)
    location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    salary: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)  # Boss 分享链接
    jd_raw: Mapped[str] = mapped_column(Text)
    jd_parsed_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    greetings_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    match_analysis_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 投/缓/弃
    status: Mapped[str] = mapped_column(String(20), default=STATUS_PENDING)
    channel: Mapped[str] = mapped_column(String(20), default="Boss")
    greeting_sent_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    greeted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_reply_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    terminated_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, onupdate=datetime.now
    )

    events: Mapped[list[StatusEvent]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class StatusEvent(Base):
    __tablename__ = "status_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    happened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    job: Mapped[Job] = relationship(back_populates="events")


class InterviewQA(Base):
    __tablename__ = "interview_qa"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("job.id"), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    session_type: Mapped[str] = mapped_column(String(10))  # mock | real
    direction: Mapped[str | None] = mapped_column(String(50), nullable=True)
    question_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    question: Mapped[str] = mapped_column(Text)
    my_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class InterviewSession(Base):
    """v2.0 对话式面试会话：messages_json 为对话历史，
    每条 {role: interviewer|candidate, text, meta: {action, question_type, is_main_question}}。"""

    __tablename__ = "interview_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    direction: Mapped[str] = mapped_column(String(100))
    jd_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    jd_source: Mapped[str | None] = mapped_column(String(10), nullable=True)  # text | ocr（v2.1-3）
    status: Mapped[str] = mapped_column(String(10), default="running")  # running | done
    messages_json: Mapped[list] = mapped_column(JSON, default=list)
    report_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # v2.3-2 薄弱项专项训练：{"weak_points": [...]}，非空时引擎走 4 题专项模式
    focus_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # v2.4 时长驱动引擎：目标时长档（25|40 分钟，None=旧固定 7 题结构）
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class InterviewCampaign(Base):
    """v2.3-3 面试战役：三轮递进（HR面→技术面→总监终面）。

    session_ids 按轮次存三个会话 id；三轮全部完成由 LLM 汇总三轮报告生成
    verdict_json（ready 判断 + 行动建议）。current_round=已完成轮数（0-3）。"""

    __tablename__ = "interview_campaign"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    direction: Mapped[str] = mapped_column(String(100))
    jd_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="running")  # running | done
    current_round: Mapped[int] = mapped_column(Integer, default=0)
    session_ids: Mapped[list] = mapped_column(JSON, default=list)
    verdict_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Knowledge(Base):
    """v2.1-2 岗位知识库：调研文件启动时同步（researched），
    未调研方向首次使用时 LLM 生成画像缓存（generated），同方向复用。"""

    __tablename__ = "knowledge"

    direction: Mapped[str] = mapped_column(String(100), primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20))  # researched | generated
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, onupdate=datetime.now
    )


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
