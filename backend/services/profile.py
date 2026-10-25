"""简历档案（v2.1-1 去结构化）：pypdf 提取全文。

v2.1-1 起不再做 LLM 结构化——源文件即真相，面试引擎与复盘评分直接用全文。
"""
from __future__ import annotations

import io

from pypdf import PdfReader


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """pypdf 提取 PDF 文本；扫描件等提取不出文字时报可读错误。"""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    if len(text) < 50:
        raise ValueError("PDF 无法提取出有效文本（可能是扫描件/图片型PDF），请使用文本版简历")
    return text
