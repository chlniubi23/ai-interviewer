"""pytest 公共配置：把 backend 目录加进 sys.path，并把数据目录指到临时目录，
确保单测绝不触碰真实 app.db（v2.6-2 最小回归）。"""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# 必须在 import models 之前生效
_TMP_DATA = tempfile.mkdtemp(prefix="ai_interviewer_test_")
os.environ.setdefault("APP_DATA_DIR", _TMP_DATA)
