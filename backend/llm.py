"""LLM 统一封装 — 智谱开放平台 GLM API（OpenAI 兼容模式）。

- chat_text: 纯文本任务
- chat_json: 结构化任务，强制 JSON 输出，解析失败自动重试 1 次
- 模型名从 .env 读：重任务 LLM_MODEL，省钱任务用 LLM_FLASH_MODEL
"""
from __future__ import annotations

import json
import datetime
import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

BASE_URL = os.getenv("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/")
API_KEY = os.getenv("ZHIPU_API_KEY", "")
MODEL = os.getenv("LLM_MODEL", "glm-4.6")
FLASH_MODEL = os.getenv("LLM_FLASH_MODEL", "glm-4.6-flash")
# 多模态模型：实测 coding 端点旗舰只收纯文本，flash 档支持图像输入（v2.1-3 JD 截图 OCR 用）
VISION_MODEL = os.getenv("LLM_VISION_MODEL", "glm-5.3-flash")

_client = OpenAI(api_key=API_KEY, base_url=BASE_URL, timeout=180)

# v2.7-4 token 成本核算：每次调用的 usage 追加落盘（data/ 已 gitignore）
USAGE_PATH = BASE_DIR / "backend" / "data" / "llm_usage.jsonl"


def _log_usage(kind: str, model: str, usage) -> None:
    if usage is None:
        return
    try:
        USAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
        rec = {
            "ts": datetime.datetime.now().isoformat(timespec="seconds"),
            "kind": kind,
            "model": model,
            "prompt_tokens": getattr(usage, "prompt_tokens", 0),
            "completion_tokens": getattr(usage, "completion_tokens", 0),
        }
        with open(USAGE_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:  # 记录失败不影响主流程
        logger.debug("usage 记录失败", exc_info=True)


def _messages(system: str | None, prompt: str) -> list[dict]:
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt})
    return msgs


def chat_text(
    prompt: str,
    system: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
) -> str:
    """普通文本输出。model=None 用旗舰档；传 flash=True 或模型名可切省钱档。"""
    resp = _client.chat.completions.create(
        model=model or MODEL,
        messages=_messages(system, prompt),
        temperature=temperature,
    )
    _log_usage("text", model or MODEL, getattr(resp, "usage", None))
    return (resp.choices[0].message.content or "").strip()


def chat_text_stream(
    prompt: str,
    system: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
):
    """流式文本输出：逐块 yield 增量文本（v2.3-1 面试官 SSE 打字机/分句即译用）。"""
    try:  # 端点支持时带上 usage（末 chunk 返回）；不支持则降级普通流
        resp = _client.chat.completions.create(
            model=model or MODEL,
            messages=_messages(system, prompt),
            temperature=temperature,
            stream=True,
            stream_options={"include_usage": True},
        )
    except Exception:
        resp = _client.chat.completions.create(
            model=model or MODEL,
            messages=_messages(system, prompt),
            temperature=temperature,
            stream=True,
        )
    for chunk in resp:
        if getattr(chunk, "usage", None):
            _log_usage("stream", model or MODEL, chunk.usage)
        if chunk.choices:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


def chat_vision(
    prompt: str,
    images: list[tuple[str, str]],
    model: str | None = None,
    temperature: float = 0.1,
) -> str:
    """多模态调用：images 是 [(base64, mime)] 列表，prompt 是文字指令。"""
    content: list[dict] = [
        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
        for b64, mime in images
    ]
    content.append({"type": "text", "text": prompt})
    resp = _client.chat.completions.create(
        model=model or VISION_MODEL,
        messages=[{"role": "user", "content": content}],
        temperature=temperature,
    )
    _log_usage("vision", model or VISION_MODEL, getattr(resp, "usage", None))
    return (resp.choices[0].message.content or "").strip()


def chat_json(
    prompt: str,
    system: str | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    schema_hint: str | None = None,
) -> dict:
    """结构化任务：要求 JSON 输出并解析；失败自动重试 1 次（换更严格指令）。"""
    schema_line = f"\n输出必须是合法 JSON（utf-8，无注释）：{schema_hint}" if schema_hint else ""
    for attempt in range(2):
        text = chat_text(
            prompt + schema_line,
            system=system or "你是严格的 JSON 输出器，只输出 JSON，不要输出任何其他文字或代码块标记。",
            model=model,
            temperature=temperature,
        )
        try:
            return _extract_json(text)
        except (ValueError, json.JSONDecodeError) as e:
            logger.warning("JSON 解析失败(第%d次): %s; 原文前200字: %s", attempt + 1, e, text[:200])
            prompt = (
                f"你上次输出无法解析为 JSON（错误：{e}）。"
                f"请重新完成任务，只输出合法 JSON。\n\n原任务：{prompt}"
            )
    raise RuntimeError("LLM 连续两次未能输出可解析的 JSON")


def _extract_json(text: str) -> dict:
    text = text.strip()
    # 去掉 ```json ... ``` 包裹
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("响应中未找到 JSON 对象")
    return json.loads(text[start : end + 1])
