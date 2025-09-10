from __future__ import annotations

from typing import Any, Dict, List
import os
import logging

from langgraph.graph import StateGraph, MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from app.config.settings import settings

logger = logging.getLogger(__name__)


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
            logger.exception("LLM init failed; continuing without LLM acks")
            llm = None

    class FormState(MessagesState):
        form: Dict[str, Any]
        next_field_index: int
        asked_index: int

    def ensure_state_defaults(state: Dict[str, Any]) -> Dict[str, Any]:
        if "form" not in state:
            state["form"] = {}
        if "next_field_index" not in state:
            state["next_field_index"] = 0
        if "asked_index" not in state:
            state["asked_index"] = -1
        return state

    async def ask_or_finish(state: Dict[str, Any]):
        state = ensure_state_defaults(state)
        logger.debug("ask_or_finish: next_field_index=%s asked_index=%s", state.get("next_field_index"), state.get("asked_index"))
        if state["next_field_index"] >= len(FIELDS):
            # All fields collected; summarize and end
            logger.debug("ask_or_finish: finished")
            return {
                "messages": [
                    AIMessage(content="Thank you. All required details have been collected.")
                ]
            }
        cur_idx = state["next_field_index"]
        if state.get("asked_index") == cur_idx:
            logger.debug("ask_or_finish: already asked for index %s, skipping emit", cur_idx)
            return {}
        field_key, prompt = FIELDS[cur_idx]
        logger.debug("ask_or_finish: asking '%s' (idx=%s)", field_key, cur_idx)
        return {
            "messages": [AIMessage(content=prompt)],
            "asked_index": cur_idx
        }

    async def cleanup_messages(state: Dict[str, Any]):
        # Ensure messages are not persisted in the checkpoint to avoid regenerate mode
        logger.debug("cleanup_messages: purge before checkpoint")
        return {"messages": []}

    async def process_user(state: Dict[str, Any]):
        state = ensure_state_defaults(state)
        idx = state["next_field_index"]
        if idx >= len(FIELDS):
            return state

        field_key, _ = FIELDS[idx]
        # Prefer transient pending_user_text if present; otherwise fall back to last human message
        pending = state.get("pending_user_text")
        messages = list(state.get("messages", []))
        logger.debug("process_user: idx=%s, field=%s, has_pending=%s, messages=%s", idx, field_key, bool(pending), len(messages))
        content = None
        if pending:
            content = str(pending)
        else:
            if messages:
                last = messages[-1]
                if isinstance(last, dict):
                    last_role = last.get("role")
                    content = last.get("content") if last_role == "user" else None
                else:
                    msg_type = getattr(last, "type", None) or last.__class__.__name__.lower()
                    last_role = "user" if msg_type == "human" else "assistant"
                    if last_role == "user":
                        content = getattr(last, "content", None)
        if not content:
            return state
        state["form"][field_key] = content
        state["next_field_index"] = idx + 1
        # Clear transient inputs and messages so checkpoints never hold messages
        state["pending_user_text"] = None
        state["messages"] = []
        logger.debug("process_user: stored '%s', next=%s, cleared messages", field_key, state["next_field_index"])
        return state


    def router_node(state: Dict[str, Any]):
        # Pure router: do not mutate persisted state
        logger.debug("router_node: next=%s, msgs=%s", state.get("next_field_index"), len(state.get("messages", [])))
        return state

    def choose_next(state: Dict[str, Any]):
        if state.get("pending_user_text"):
            logger.debug("choose_next: pending_user_text present -> process")
            return "process"
        messages = state.get("messages", [])
        if not messages:
            logger.debug("choose_next: no messages -> ask")
            return "ask"
        # Scan from the end to find the most recent human/assistant indicator
        for msg in reversed(messages):
            if isinstance(msg, dict):
                role = msg.get("role")
            else:
                msg_type = getattr(msg, "type", None) or msg.__class__.__name__.lower()
                role = "user" if msg_type == "human" else "assistant"
            if role in ("user", "assistant"):
                decision = "process" if role == "user" else "ask"
                logger.debug("choose_next: recent role=%s -> %s", role, decision)
                return decision
        logger.debug("choose_next: no qualifying role found -> ask")
        return "ask"

    async def sanitize_incoming(state: Dict[str, Any]):
        # Move client-provided human content into a transient field and keep messages empty
        msgs = list(state.get("messages", []))
        content = state.get("pending_user_text")
        if not content:
            for msg in reversed(msgs):
                if isinstance(msg, dict):
                    role = msg.get("role")
                    mcontent = msg.get("content")
                else:
                    t = getattr(msg, "type", None) or msg.__class__.__name__.lower()
                    role = "user" if t == "human" else "assistant"
                    mcontent = getattr(msg, "content", None)
                if role == "user" and mcontent:
                    content = mcontent
                    break
        logger.debug("sanitize_incoming: extracted_pending=%s from %s incoming msgs", bool(content), len(msgs))
        return {"pending_user_text": content, "messages": []}

    async def entry_cleanup(state: Dict[str, Any]):
        logger.debug("entry_cleanup: purge messages at run start")
        return {"messages": []}

    graph = StateGraph(FormState)
    graph.add_node("ask", ask_or_finish)
    graph.add_node("cleanup", cleanup_messages)
    graph.add_node("process", process_user)
    graph.add_node("router", router_node)
    graph.add_node("sanitize", sanitize_incoming)
    graph.add_node("entry_cleanup", entry_cleanup)
    graph.set_entry_point("entry_cleanup")

    graph.add_conditional_edges("router", choose_next, {"ask": "ask", "process": "process"})
    graph.add_edge("process", "ask")
    graph.add_edge("ask", "cleanup")
    graph.add_edge("entry_cleanup", "sanitize")
    graph.add_edge("sanitize", "router")

    checkpointer = MemorySaver()
    compiled = graph.compile(checkpointer=checkpointer)
    logger.info("Compiled form agent with MemorySaver; nodes: entry_cleanup, sanitize, router, process, ask, cleanup")
    return compiled

