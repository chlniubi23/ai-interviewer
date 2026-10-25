"""TTS API（v2.1-4 L2）：神经音色合成，失败 502 由前端回退浏览器原生。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

import services.tts as tts_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TtsBody(BaseModel):
    text: str
    rate: float = 1.0


@router.post("")
def synthesize(body: TtsBody) -> Response:
    try:
        audio = tts_service.synthesize(body.text, body.rate)
    except tts_service.TtsError as e:
        raise HTTPException(502, str(e))
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},  # 服务端已做哈希缓存；浏览器不缓存便于回退判定
    )
