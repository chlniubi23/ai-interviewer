"""edge-tts 神经音色合成（v2.1-4 L2）。

- 非官方免费接口（Edge 浏览器朗读同源），需联网；失败由前端自动回退浏览器原生 TTS（L1）
- 按文本+音色+语速哈希本地缓存（data/tts_cache/*.mp3），同句重播零成本
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path

import edge_tts

logger = logging.getLogger(__name__)

VOICE = "zh-CN-XiaoxiaoNeural"
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "tts_cache"
MAX_TEXT = 1200  # 面试官单轮话不会超过这个量级，超长截断保护
MAX_CACHE_FILES = 500  # v2.6-3 膨胀治理：缓存文件数上限（超限删最旧）


class TtsError(RuntimeError):
    """合成失败（网络/服务不可用），调用方返回 502 供前端回退。"""


def _cache_path(text: str, rate_pct: int) -> Path:
    key = hashlib.sha1(f"{VOICE}|{rate_pct:+d}|{text}".encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{key}.mp3"


def _prune_cache() -> None:
    """缓存文件数超过上限时按 mtime 删最旧（listdir+stat 数百文件毫秒级，写缓存后跑不拖慢响应）。"""
    try:
        files = [p for p in CACHE_DIR.iterdir() if p.is_file() and p.suffix == ".mp3"]
        if len(files) <= MAX_CACHE_FILES:
            return
        files.sort(key=lambda p: p.stat().st_mtime)
        excess = len(files) - MAX_CACHE_FILES
        for old in files[:excess]:
            try:
                old.unlink()
            except OSError:
                pass  # 并发播放占用等，跳过留给下次
        logger.info("TTS 缓存轮转：删除 %d 个最旧文件（余 %d）", excess, MAX_CACHE_FILES)
    except OSError as e:
        logger.warning("TTS 缓存轮转失败（不影响播放）: %s", e)


def synthesize(text: str, rate: float) -> bytes:
    """文本 → mp3 bytes。rate 为 0.7-1.4 的倍率，转 edge-tts 的 ±百分比。"""
    text = (text or "").strip()[:MAX_TEXT]
    if not text:
        raise TtsError("文本为空")
    rate_pct = round((rate - 1) * 100)
    cache = _cache_path(text, rate_pct)
    if cache.is_file() and cache.stat().st_size > 0:
        return cache.read_bytes()
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        chunks: list[bytes] = []

        async def run() -> None:
            comm = edge_tts.Communicate(text, VOICE, rate=f"{rate_pct:+d}%")
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    chunks.append(chunk["data"])

        asyncio.run(run())
    except Exception as e:  # 网络/服务异常统一兜底
        raise TtsError(f"神经音色合成失败：{type(e).__name__}: {e}") from e
    if not chunks:
        raise TtsError("神经音色合成返回空音频")
    audio = b"".join(chunks)
    try:
        tmp = cache.with_suffix(".tmp")
        tmp.write_bytes(audio)
        tmp.replace(cache)
    except OSError as e:
        logger.warning("TTS 缓存写入失败（不影响播放）: %s", e)
    _prune_cache()
    return audio
