# AI 面试官（job-copilot）

本地单机 AI 模拟面试平台：上传简历 → 选方向/时长（可选 JD 粘贴或截图识别）→ 语音对话式模拟面试（SSE 流式逐字输出 + 分句播报 + 沉浸面试间）→ 五维雷达统一报告 → 薄弱项专项训练 / 三轮面试战役。

## 启动

双击 `start.bat`（自动检查环境 → 后端 9000 → 前端 5173）。手机与电脑同一 WiFi 时扫首页二维码用手机访问。

## 最小回归测试（v2.6-2）

改完代码跑这两条，全绿再交付：

```bash
# 后端引擎纯逻辑单测（不调 LLM，约 1 秒）
cd backend && .venv\Scripts\python.exe -m pytest tests/ -q

# 前端冒烟（启动→三页路由→主题切换→表单校验，不调 LLM，约 3 秒；会复用已启动的服务）
cd frontend && npx playwright test
```

## 技术栈

Python 3.12 + FastAPI + SQLAlchemy + SQLite（智谱 GLM，key 放 backend/.env）｜Vite + React 19 + TS + react-router 7 + TanStack Query 5 + framer-motion｜edge-tts 神经音色 + Web Speech 听写。

## 注意

- 数据全在本地 `backend/data/`（简历/会话/题库/知识库）；启动时自动备份 SQLite 快照到 `backend/data/backups/`（保留最近 7 份）
- 开发契约与实现记录见 `../PLAN-v2.6-可信与交付.md`（历史版本 PLAN 同目录存档）
