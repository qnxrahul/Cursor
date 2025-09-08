from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uuid
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from app.agents.form_agent import build_form_agent_graph, FIELDS

router = APIRouter()


graph = build_form_agent_graph()


def include_agent_routes(app):
    # Mount AG-UI-compatible streaming endpoint
    add_langgraph_fastapi_endpoint(app, graph, "/agent")
    app.include_router(router)
    return app


# Simple JSON chat API for Angular (progressive chat without streaming)
class StartChatResponse(BaseModel):
    thread_id: str
    message: str
    field_key: str


class RespondRequest(BaseModel):
    thread_id: str
    message: str


class RespondResponse(BaseModel):
    thread_id: str
    message: str
    done: bool
    field_key: str | None = None
    form_partial: dict | None = None
    form: dict | None = None


_THREAD_STATE: dict[str, dict] = {}


@router.post("/api/chat/start", response_model=StartChatResponse)
async def start_chat():
    thread_id = str(uuid.uuid4())
    state = {"messages": [], "form": {}, "next_field_index": 0}
    _THREAD_STATE[thread_id] = state
    # Ask first question
    # First question
    prompt = FIELDS[0][1]
    state["messages"].append({"role": "assistant", "content": prompt})
    field_key = FIELDS[0][0]
    return StartChatResponse(thread_id=thread_id, message=prompt, field_key=field_key)


@router.post("/api/chat/respond", response_model=RespondResponse)
async def respond_chat(req: RespondRequest):
    state = _THREAD_STATE.get(req.thread_id)
    if not state:
        return JSONResponse({"error": "invalid_thread"}, status_code=400)
    # Add user's message
    state.setdefault("messages", []).append({"role": "user", "content": req.message})
    idx = state.get("next_field_index", 0)
    if idx < len(FIELDS):
        field_key, _ = FIELDS[idx]
        state.setdefault("form", {})[field_key] = req.message
        state["next_field_index"] = idx + 1

    # Next prompt or finish
    next_index = state.get("next_field_index", 0)
    done = bool(next_index >= len(FIELDS))
    if done:
        _THREAD_STATE[req.thread_id] = state
        return RespondResponse(
            thread_id=req.thread_id,
            message="Thank you. All required details have been collected.",
            done=True,
            field_key=None,
            form_partial=state.get("form"),
            form=state.get("form"),
        )
    # Ask next
    next_field_key, next_prompt = FIELDS[next_index]
    state.setdefault("messages", []).append({"role": "assistant", "content": next_prompt})
    _THREAD_STATE[req.thread_id] = state
    return RespondResponse(
        thread_id=req.thread_id,
        message=next_prompt,
        done=False,
        field_key=next_field_key,
        form_partial=state.get("form"),
        form=None,
    )


