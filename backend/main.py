"""FastAPI 入口 — AI 面试官（v2.0，原求职作战台求职侧功能已废弃）。"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import llm
import services.knowledge as knowledge_service
from models import Base, SessionLocal, engine
from routers import interview, profile, tts

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="AI 面试官 Job Copilot", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本地单机工具，手机经 Vite 代理或局域网直连均可访问
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


def _ensure_columns() -> None:
    """SQLite 轻量迁移：create_all 不会修改已存在的表，新列在这里补。"""
    from sqlalchemy import inspect, text

    expected = {
        "job": {"greetings_json": "TEXT"},
        "interview_qa": {"session_id": "TEXT", "question_type": "TEXT"},
        "profile": {"pdf_path": "TEXT"},
        "interview_session": {"jd_source": "TEXT", "focus_json": "TEXT", "duration_min": "INTEGER"},
    }
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in expected.items():
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for col, ddl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))


_ensure_columns()


def _backup_db() -> None:
    """v2.6-1 数据安全：启动时用 SQLite backup API 做安全快照（不直接复制正在写的文件），
    轮转保留最近 7 份。app.db 若处于云同步盘目录内，写入撞同步有损坏风险——备份是
    成本最低的兜底。失败只记日志不阻断启动。长期建议：项目整体移出云同步盘目录。
    """
    import sqlite3
    from datetime import datetime

    from models import DB_PATH

    backup_dir = DB_PATH.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    dest_path = backup_dir / f"app_{datetime.now():%Y%m%d_%H%M%S}.db"
    # 同秒重复启动：覆盖式重建（先删旧快照再 backup）
    if dest_path.exists():
        dest_path.unlink()
    src = sqlite3.connect(DB_PATH)
    dest = sqlite3.connect(dest_path)
    try:
        src.backup(dest)  # 安全快照：源库有并发写入也不锁死
        logger.info("数据库备份完成: %s", dest_path.name)
    finally:
        src.close()
        dest.close()
    # 轮转：按时间戳命名排序，保留最近 7 份
    backups = sorted(backup_dir.glob("app_*.db"))
    for old in backups[:-7]:
        try:
            old.unlink()
        except OSError:
            logger.warning("备份轮转删除失败: %s", old.name)


logger = logging.getLogger(__name__)
try:
    _backup_db()
except Exception:
    logger.exception("数据库备份失败（不阻断启动，建议检查云同步盘状态）")

# v2.1-2：调研知识文件同步进 knowledge 表（researched；文件为真相，每次启动刷新）
with SessionLocal() as db:
    knowledge_service.seed_researched(db)

app.include_router(profile.router)
app.include_router(interview.router)
app.include_router(tts.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "llm_model": llm.MODEL}


@app.get("/api/lan")
def lan_ips() -> dict:
    """本机局域网 IPv4 列表，前端据此生成手机访问二维码（手机与电脑须同一 WiFi）。

    默认路由出口的 IP 排第一（最可能是真实 WiFi 网卡），虚拟网卡（WSL/VMware）的排后面。
    """
    import socket

    primary: str | None = None
    others: set[str] = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("10.255.255.255", 1))  # 只选路由不实际发包
        primary = s.getsockname()[0]
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip != primary:
                others.add(ip)
    except OSError:
        pass
    ips = ([primary] if primary else []) + sorted(others)
    ips = [ip for ip in ips if not ip.startswith("169.254.")]
    return {"ips": ips}
