from __future__ import annotations

from typing import Any, Dict, List
import os

from langgraph.graph import StateGraph, MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.config.settings import settings


FIELDS = [
    ("name", "Please provide your full name."),
    ("email", "What is your email address?"),
    ("issue_details", "Describe the issue in detail."),
    ("type", "What type of request is this? (e.g., incident, service, access)"),
    ("urgency", "What is the urgency? (low, medium, high, critical)"),
    ("location", "Where is the issue located? (office/site/remote)"),
]


def build_form_agent_graph():
    # Configure OpenRouter-backed LLM via OpenAI-compatible client if key provided
    llm = None
    if settings.openrouter_api_key:
        os.environ.setdefault("OPENAI_API_KEY", settings.openrouter_api_key)
        os.environ.setdefault("OPENAI_BASE_URL", settings.openrouter_base_url)
        try:
            llm = ChatOpenAI(
                model=settings.openrouter_model,
                temperature=0.2,
            )
        except Exception:
            llm = None

    class FormState(MessagesState):
        form: Dict[str, Any]
        next_field_index: int

    def ensure_state_defaults(state: Dict[str, Any]) -> Dict[str, Any]:
        if "form" not in state:
            state["form"] = {}
        if "next_field_index" not in state:
            state["next_field_index"] = 0
        return state

    async def ask_or_finish(state: Dict[str, Any]):
        state = ensure_state_defaults(state)
        if state["next_field_index"] >= len(FIELDS):
            # All fields collected; summarize and end
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "content": "Thank you. All required details have been collected."
                    }
                ]
            }
        field_key, prompt = FIELDS[state["next_field_index"]]
        return {
            "messages": [
                {"role": "assistant", "content": prompt}
            ]
        }

    async def process_user(state: Dict[str, Any]):
        state = ensure_state_defaults(state)
        idx = state["next_field_index"]
        if idx >= len(FIELDS):
            return state

        field_key, _ = FIELDS[idx]
        messages = state.get("messages", [])
        if not messages:
            return state

        last = messages[-1]
        # Support both dict-shaped and LangChain BaseMessage objects
        if isinstance(last, dict):
            last_role = last.get("role")
            content = last.get("content")
        else:
            msg_type = getattr(last, "type", None) or last.__class__.__name__.lower()
            last_role = "user" if msg_type == "human" else "assistant"
            content = getattr(last, "content", None)

        if last_role == "user" and content:
            state["form"][field_key] = content
            state["next_field_index"] = idx + 1
        return state

    async def llm_ack(state: Dict[str, Any]):
        state = ensure_state_defaults(state)
        idx = max(0, state.get("next_field_index", 0) - 1)
        if idx < len(FIELDS):
            field_key, _ = FIELDS[idx]
            field_value = state.get("form", {}).get(field_key, "")
            content = f"Recorded {field_key}."
            if llm is not None:
                try:
                    prompt = [
                        SystemMessage(content=(
                            "You are a helpful service desk agent. Acknowledge the user's answer succinctly (one short sentence). "
                            "Do not ask the next question."
                        )),
                        HumanMessage(content=f"Field: {field_key}. Answer: {field_value}"),
                    ]
                    resp = await llm.ainvoke(prompt)
                    content = getattr(resp, "content", None) or str(resp)
                except Exception:
                    pass
            return {"messages": [{"role": "assistant", "content": content}]}
        return {}

    def router_node(state: Dict[str, Any]):
        return ensure_state_defaults(state)

    def choose_next(state: Dict[str, Any]):
        messages = state.get("messages", [])
        if not messages:
            return "ask"
        last = messages[-1]
        if isinstance(last, dict):
            last_role = last.get("role")
        else:
            msg_type = getattr(last, "type", None) or last.__class__.__name__.lower()
            last_role = "user" if msg_type == "human" else "assistant"
        return "process" if last_role == "user" else "ask"

    graph = StateGraph(dict)
    graph.add_node("ask", ask_or_finish)
    graph.add_node("process", process_user)
    graph.add_node("ack", llm_ack)
    graph.add_node("router", router_node)
    graph.set_entry_point("router")

    graph.add_conditional_edges("router", choose_next, {"ask": "ask", "process": "process"})
    graph.add_edge("process", "ack")
    graph.add_edge("ack", "ask")

    checkpointer = MemorySaver()
    return graph.compile(checkpointer=checkpointer)

