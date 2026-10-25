"""JD 截图 OCR（v2.1-3）：多模态识别为可编辑的文字 JD。

图片全部来自用户主动上传的本地文件（粘贴/拖拽/选择），无任何联网抓取（红线）。
限制沿用 v1：≤5 张、单张 ≤10MB、魔数嗅探图片类型防伪装。
"""
from __future__ import annotations

import base64
import logging

import llm

logger = logging.getLogger(__name__)

MAX_IMAGES = 5
MAX_SIZE = 10 * 1024 * 1024

# 常见图片格式的魔数（防伪装成图片的文本文件）
_MAGIC: list[tuple[bytes, str]] = [
    ((0xFF, 0xD8, 0xFF), "image/jpeg"),
    ((0x89, 0x50, 0x4E, 0x47), "image/png"),
    ((0x47, 0x49, 0x46, 0x38), "image/gif"),
]


def _sniff_mime(head: bytes) -> str | None:
    for magic, mime in _MAGIC:
        if head.startswith(bytes(magic)):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:2] == b"BM":
        return "image/bmp"
    return None


class OcrInputError(ValueError):
    """上传内容不合法（数量/大小/非图片）。"""


def load_images(files: list) -> list[tuple[str, str]]:
    """UploadFile 列表 → [(base64, mime)]。校验数量/大小/魔数。"""
    if not files:
        raise OcrInputError("请至少上传一张 JD 截图")
    if len(files) > MAX_IMAGES:
        raise OcrInputError(f"最多 {MAX_IMAGES} 张截图（长 JD 可用手机长截屏）")
    images: list[tuple[str, str]] = []
    for f in files:
        data = f.file.read()
        if len(data) > MAX_SIZE:
            raise OcrInputError(f"「{f.filename or '图片'}」超过 10MB，请压缩后重试")
        mime = _sniff_mime(data[:16])
        if not mime:
            raise OcrInputError(f"「{f.filename or '文件'}」不是受支持的图片格式（jpg/png/webp/gif/bmp）")
        images.append((base64.b64encode(data).decode("ascii"), mime))
    return images


OCR_PROMPT = """以下是求职岗位 JD 的截图（可能是多张，按顺序属于同一份 JD，多图请按序拼合）。请把图片里的 JD 内容完整转成文字：
- 只保留 JD 正文：职位名称、公司/部门（如有）、岗位职责、任职要求、加分项
- 去掉 App/网页界面元素（按钮、导航、banner、推荐位、公司相册、福利标签等与 JD 无关的内容）
- 保留原有条目编号与换行结构，忠实转录，不要总结、改写或补充图片中没有的内容
- 输出纯文本，不要任何说明文字或代码块标记"""


def ocr_images(images: list[tuple[str, str]]) -> str:
    """多模态 OCR → 文字 JD。"""
    text = llm.chat_vision(OCR_PROMPT, images, temperature=0.1)
    if len(text.strip()) < 20:
        raise ValueError("未能从截图中识别出 JD 内容，请确认截图包含完整岗位职责与要求")
    return text.strip()
