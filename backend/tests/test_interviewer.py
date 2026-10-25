"""引擎纯逻辑单测（v2.6-2 最小回归）——全程不调 LLM。

覆盖：三态切换（classic/focused/duration）、时长态追问 5 层上限、
剩余 ≤5 分钟/反问/70% 时长的收尾放行条件、end 校验拒绝、
qa_pairs 追问合并、滚动窗口裁剪。
"""
from services.interviewer import (
    FOCUSED_MAIN_COUNT,
    HISTORY_WINDOW,
    MAX_DURATION_FOLLOWUP,
    MAX_FOLLOWUP,
    _history_block,
    _qa_pairs,
    _validate_turn,
    session_state,
)


def iv(text, action="followup", qtype=None, main=False):
    """构造面试官消息。"""
    return {"role": "interviewer", "text": text,
            "meta": {"action": action, "question_type": qtype, "is_main_question": main}}


def cd(text):
    """构造候选人消息。"""
    return {"role": "candidate", "text": text, "meta": {}}


# ---------- 三态切换 ----------

def test_mode_classic_default():
    st = session_state([])
    assert st["mode"] == "classic" and st["next_type"] == "自我介绍" and not st["all_asked"]


def test_mode_focused_structure_none():
    st = session_state([], None)
    assert st["mode"] == "focused" and st["next_type"] is None and not st["all_asked"]


def test_mode_duration_when_duration_given():
    st = session_state([], duration_min=25, elapsed_min=3)
    assert st["mode"] == "duration" and st["remaining_min"] == 22 and not st["time_low"]


def test_classic_advances_structure():
    msgs = [iv("开场自我介绍", "question", "自我介绍", True)]
    st = session_state(msgs)
    assert st["main_count"] == 1 and st["next_type"] == "项目深挖"


def test_focused_all_asked_after_four_mains():
    msgs = []
    for i in range(FOCUSED_MAIN_COUNT):
        msgs.append(cd("答"))
        msgs.append(iv(f"主问题{i+1}", "question", "弱项", True))
    st = session_state(msgs, None)
    assert st["all_asked"] and st["main_count"] == FOCUSED_MAIN_COUNT


# ---------- 时长态：时间预算与追问上限 ----------

def test_duration_time_low_threshold():
    st = session_state([iv("开场", "question", "自我介绍", True)], duration_min=25, elapsed_min=20.5)
    assert st["time_low"] and st["remaining_min"] == 4.5


def test_duration_followup_depth_counts():
    msgs = [iv("主问题", "question", "项目深挖", True)]
    for i in range(3):
        msgs.append(cd("答"))
        msgs.append(iv(f"追{i}", "followup", "项目深挖"))
    st = session_state(msgs, duration_min=25, elapsed_min=8)
    assert st["followup_depth"] == 3


def test_duration_followup_cap_is_five():
    msgs = [iv("主问题", "question", "项目深挖", True)]
    for i in range(MAX_DURATION_FOLLOWUP):
        msgs.append(cd("答"))
        msgs.append(iv(f"追{i}", "followup", "项目深挖"))
    st = session_state(msgs, duration_min=25, elapsed_min=8)
    assert st["followup_depth"] == MAX_DURATION_FOLLOWUP
    v = _validate_turn({"say": "再追", "action": "followup"}, st)
    assert v and "安全上限" in v


def test_classic_followup_cap_is_two():
    msgs = [iv("主问题", "question", "项目深挖", True)]
    for i in range(MAX_FOLLOWUP):
        msgs.append(cd("答"))
        msgs.append(iv(f"追{i}", "followup", "项目深挖"))
    st = session_state(msgs)
    v = _validate_turn({"say": "再追", "action": "followup"}, st)
    assert v and "上限" in v


# ---------- 时长态：end 放行条件 ----------

def _duration_msgs():
    return [
        iv("开场自我介绍", "question", "自我介绍", True),
        cd("介绍"),
        iv("项目深挖", "question", "项目深挖·客服Agent", True),
        cd("答"),
    ]


def test_duration_end_rejected_when_early():
    st = session_state(_duration_msgs(), duration_min=25, elapsed_min=5)
    v = _validate_turn({"say": "结束", "action": "end"}, st)
    assert v and "不得结束" in v


def test_duration_end_allowed_when_time_low():
    st = session_state(_duration_msgs(), duration_min=25, elapsed_min=21)
    assert _validate_turn({"say": "收尾", "action": "end"}, st) is None


def test_duration_end_allowed_after_reverse_question():
    msgs = _duration_msgs() + [iv("反问环节", "question", "反问环节", True), cd("问")]
    st = session_state(msgs, duration_min=25, elapsed_min=10)
    assert _validate_turn({"say": "收尾", "action": "end"}, st) is None


def test_duration_end_allowed_at_seventy_percent():
    st = session_state(_duration_msgs(), duration_min=25, elapsed_min=17.5)
    assert _validate_turn({"say": "收尾", "action": "end"}, st) is None


def test_duration_empty_say_rejected_any_mode():
    st = session_state(_duration_msgs(), duration_min=25, elapsed_min=21)
    assert _validate_turn({"say": "  ", "action": "end"}, st) == "say 为空"


# ---------- classic/focused：end 校验拒绝 ----------

def test_classic_end_rejected_before_seven_mains():
    msgs = [iv("开场", "question", "自我介绍", True)]
    st = session_state(msgs)
    v = _validate_turn({"say": "结束", "action": "end"}, st)
    assert v and "不得结束" in v


def test_classic_end_allowed_after_all_seven():
    msgs = []
    for t in ["自我介绍", "项目深挖", "项目深挖", "技术概念", "技术概念", "场景假设", "反问环节"]:
        msgs.append(cd("答"))
        msgs.append(iv(t, "question", t, True))
    st = session_state(msgs)
    assert st["all_asked"]
    assert _validate_turn({"say": "收尾", "action": "end"}, st) is None


# ---------- _qa_pairs：追问合并 ----------

def test_qa_pairs_merges_followups_into_question():
    msgs = [
        iv("主问题A", "question", "项目深挖", True),
        cd("答1"),
        iv("追问A1", "followup", "项目深挖"),
        cd("答1补充"),
        iv("主问题B", "question", "技术概念", True),
        cd("答2"),
    ]
    pairs = _qa_pairs(msgs)
    assert len(pairs) == 2
    assert "（追问：追问A1）" in pairs[0]["question"]
    assert pairs[0]["answer"] == "答1\n答1补充"
    assert pairs[1]["question"] == "主问题B"


def test_qa_pairs_skips_unanswered_tail():
    msgs = [iv("主问题A", "question", "项目深挖", True), cd("答"), iv("主问题B", "question", "技术概念", True)]
    pairs = _qa_pairs(msgs)
    assert len(pairs) == 1 and pairs[0]["question"] == "主问题A"


# ---------- 滚动窗口裁剪 ----------

def test_history_block_trims_to_window():
    msgs = []
    for i in range(HISTORY_WINDOW + 8):
        role = "interviewer" if i % 2 == 0 else "candidate"
        if role == "interviewer":
            msgs.append(iv(f"主问题{i}", "question", f"题型{i%7}", main=True))
        else:
            msgs.append(cd(f"回答{i}"))
    block = _history_block(msgs)
    assert "（更早对话仅保留主问题）" in block
    assert "主问题0" in block  # 早期主问题保留题目
    assert "回答0" not in block  # 早期候选人回答被裁
    assert f"回答{HISTORY_WINDOW + 7}" in block  # 窗口内全文保留


def test_history_block_no_trim_within_window():
    msgs = [iv("主问题", "question", "项目深挖", True), cd("答")]
    block = _history_block(msgs)
    assert "（更早对话仅保留主问题）" not in block
