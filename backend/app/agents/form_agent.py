from __future__ import annotations

from typing import Any, Dict, List, Optional
import os
import logging
import re
import json
from pathlib import Path

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

    # Load field-aware knowledge
    knowledge: Dict[str, Any] = {}
    try:
        kb_path = Path(__file__).parent / "knowledge" / "service_auth_knowledge.json"
        with open(kb_path, "r", encoding="utf-8") as f:
            knowledge = json.load(f)
        logger.info("Loaded service auth knowledge: fields=%s", list(knowledge.get("fields", {}).keys()))
    except Exception:
        logger.exception("Failed to load service auth knowledge; proceeding without it")

    # Load forms manifest for dynamic schemas
    forms_manifest: Dict[str, Any] = {}
    try:
        fm_path = Path(__file__).parent / "forms_manifest.json"
        with open(fm_path, "r", encoding="utf-8") as f:
            forms_manifest = json.load(f)
        logger.info("Loaded forms manifest: %s", list(forms_manifest.keys()))
    except Exception:
        logger.exception("Failed to load forms manifest; proceeding without it")

    class FormState(MessagesState):
        form: Dict[str, Any]
        next_field_index: int
        asked_index: int
        pending_user_text: Optional[str]
        awaiting_confirmation: bool
        pending_field_index: Optional[int]
        pending_value: Optional[str]
        schema: Optional[Dict[str, Any]]
        form_type: Optional[str]
        schema_confirmed: bool
        theme: Optional[Dict[str, Any]]
        schema_build_mode: bool
        proposed_form_type: Optional[str]
        greeted: bool
        awaiting_schema_changes: bool

    def ensure_state_defaults(state: Dict[str, Any]) -> Dict[str, Any]:
        if "form" not in state:
            state["form"] = {}
        if "next_field_index" not in state:
            state["next_field_index"] = 0
        if "asked_index" not in state:
            state["asked_index"] = -1
        if "pending_user_text" not in state:
            state["pending_user_text"] = None
        if "awaiting_confirmation" not in state:
            state["awaiting_confirmation"] = False
        if "pending_field_index" not in state:
            state["pending_field_index"] = None
        if "pending_value" not in state:
            state["pending_value"] = None
        if "schema" not in state:
            state["schema"] = None
        if "form_type" not in state:
            state["form_type"] = None
        if "schema_confirmed" not in state:
            state["schema_confirmed"] = False
        if "theme" not in state:
            state["theme"] = None
        if "schema_build_mode" not in state:
            state["schema_build_mode"] = False
        if "proposed_form_type" not in state:
            state["proposed_form_type"] = None
        if "greeted" not in state:
            state["greeted"] = False
        if "awaiting_schema_changes" not in state:
            state["awaiting_schema_changes"] = False
        return state

    async def ask_or_finish(state: Dict[str, Any]):
        state = ensure_state_defaults(state)
        logger.debug("ask_or_finish: next_field_index=%s asked_index=%s awaiting=%s", state.get("next_field_index"), state.get("asked_index"), state.get("awaiting_confirmation"))

        # Friendly greeting once
        if (not state.get("greeted")):
            services_list = []
            try:
                for key, val in forms_manifest.items():
                    title = (val.get("title") or key.replace("_", " ").title())
                    # Show as Request per requirement
                    title_req = title.replace("Form", "Request")
                    services_list.append(f"- {title_req} ({key})")
            except Exception:
                services_list = []
            services_text = "\n".join(services_list) if services_list else (
                "- Service Authorization Request (service_auth)\n"
                "- Exit Request Request (exit_request)\n"
                "- Reimbursement Request (reimbursement)\n"
                "- Bonafide Certificate Request (bonafide_certificate)"
            )
            greet = (
                "Hi, I'm HelpDesk Assistant. I can help you create and submit IT helpdesk related requests.\n\n"
                "Here are some requests I can create right away:\n"
                f"{services_text}\n\n"
                "Tell me which one you want (e.g., 'reimbursement request') or describe a new form (e.g., 'create a policy request UI'), and I'll build it for you."
            )
            return {"messages": [AIMessage(content=greet)], "greeted": True}

        # If schema not chosen yet, ask which form type user needs
        if not state.get("schema") and not state.get("schema_build_mode"):
            choices = ", ".join(sorted(forms_manifest.keys())) if forms_manifest else "service_auth"
            msg = f"Which form would you like to fill? (choices: {choices})"
            return {"messages": [AIMessage(content=msg)]}

        # If building a custom schema, ask user to provide fields specification
        if state.get("schema_build_mode") and not state.get("schema"):
            hint = (
                "We don't have a manifest for that form. Please list fields as 'key:type:required(options)', "
                "comma-separated.\n"
                "- Types: text, email, number, date, textarea, select, radio, checkbox\n"
                "- Example: name:text:required, email:email:required, status:select:required(pending,approved)\n"
                "Optionally set submit label like: submit_label:Send"
            )
            return {"messages": [AIMessage(content=hint)]}

        # If schema chosen but not confirmed, present fields and ask for changes
        if not state.get("schema_confirmed"):
            # If user already said they want changes, proactively ask for specifics
            if state.get("awaiting_schema_changes"):
                state["awaiting_schema_changes"] = False
                return {"messages": [AIMessage(content=(
                    "Okay. Tell me what to change — you can:\n"
                    "- add field key:type:required(options)\n"
                    "- remove field <name> (by key or label)\n"
                    "- theme {\"primary\": \"#0052cc\", ...}\n"
                    "Describe edits naturally if you prefer."
                ))]}
            fields = [f.get("label") or f.get("key") for f in state["schema"].get("fields", [])]
            preview = "\n - " + "\n - ".join(fields) if fields else " (no fields)"
            msg = (
                f"I have rendered the '{state.get('form_type')}' with these fields:{preview}\n"
                "You can now add or remove fields (e.g., add field amount:number:required, remove field urgency) or update theme. No need to say yes or no."
            )
            return {"messages": [AIMessage(content=msg)]}

        # If awaiting confirmation, ask to confirm the pending value
        if state.get("awaiting_confirmation") and state.get("pending_field_index") is not None:
            idx = int(state["pending_field_index"])
            field_key, _ = FIELDS[idx]
            pending_val = state.get("pending_value") or ""
            # More helpful, natural confirmation prompt
            confirm_text = (
                f"I understood your {field_key.replace('_',' ')} as: '{pending_val}'.\n"
                "- Reply 'yes' to confirm\n- Reply 'no' to re-enter\n- Or type the correct value."
            )
            return {"messages": [AIMessage(content=confirm_text)]}
        # Use schema fields when available
        fields_list = FIELDS
        if state.get("schema") and isinstance(state["schema"], dict):
            schema_fields = state["schema"].get("fields", [])
            if schema_fields:
                fields_list = [(f.get("key"), f.get("prompt") or f.get("label") or f.get("key")) for f in schema_fields]
        if state["next_field_index"] >= len(fields_list):
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
        field_key, prompt = fields_list[cur_idx]
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

        # Helper: normalization (same as below)
        def normalize_field_value(key: str, value: str) -> str:
            text = (value or "").strip()
            PREFIXES = [
                r"^my name is\s+",
                r"^i am\s+",
                r"^i\'m\s+",
                r"^this is\s+",
                r"^it\'s\s+",
                r"^name\s*[:\-]\s*",
                r"^email\s*[:\-]\s*",
                r"^the issue is\s+",
                r"^issue is\s+",
                r"^problem is\s+",
                r"^it is\s+",
            ]
            def strip_prefixes(s: str) -> str:
                s2 = s.strip()
                for pat in PREFIXES:
                    s2 = re.sub(pat, "", s2, flags=re.IGNORECASE)
                return s2.strip()
            if key == "name":
                s = strip_prefixes(text)
                s = re.sub(r"[\.,!]+$", "", s).strip()
                parts = [p for p in re.split(r"\s+", s) if p]
                s = " ".join([p[:1].upper() + p[1:] if p else p for p in parts])
                return s
            if key == "email":
                m = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
                return m.group(0).lower() if m else text
            if key == "issue_details":
                return strip_prefixes(text)
            if key == "type":
                lower = text.lower()
                if "incident" in lower:
                    return "incident"
                if "service" in lower:
                    return "service"
                if "access" in lower:
                    return "access"
                return re.split(r"\s+", lower)[0]
            if key == "urgency":
                lower = text.lower()
                if any(w in lower for w in ["critical", "severe"]):
                    return "critical"
                if any(w in lower for w in ["high", "urgent"]):
                    return "high"
                if "medium" in lower:
                    return "medium"
                if "low" in lower:
                    return "low"
                return lower.strip()
            if key == "location":
                lower = text.lower()
                # Expand synonyms for location
                office_syn = {"office", "hq", "headquarters"}
                site_syn = {"site", "onsite", "on site"}
                remote_syn = {"remote", "home", "wfh", "work from home"}
                if any(tok in lower for tok in office_syn):
                    return "office"
                if any(tok in lower for tok in site_syn):
                    return "site"
                if any(tok in lower for tok in remote_syn):
                    return "remote"
                return lower.strip()
            return text

        # Optional: LLM-assisted extraction for smarter suggestions
        def llm_extract_field_suggestion(field: str, raw_text: str) -> Optional[str]:
            if llm is None:
                return None
            try:
                field_info = knowledge.get("fields", {}).get(field, {})
                f_format = field_info.get("format", "")
                f_examples = "\n".join(["- " + ex for ex in field_info.get("examples", [])])
                prompt = (
                    f"You are a field-aware intake assistant for {knowledge.get('domain','Service Desk')}.\n"
                    f"Field: {field.replace('_',' ')}\n"
                    f"Expected format: {f_format}\n"
                    f"Examples:\n{f_examples}\n\n"
                    "Task: Extract the user's answer for this field from the message.\n"
                    "- Return only the value, no extra words.\n"
                    "- For email, return a valid email like user@domain.tld.\n"
                    "- For location, return exactly one of: office, site, remote.\n"
                    f"Message: {raw_text}"
                )
                resp = llm.invoke(prompt)  # type: ignore
                val = getattr(resp, "content", None)
                if isinstance(val, str):
                    return val.strip()
            except Exception:
                logger.exception("LLM extract failed for field=%s", field)
            return None

        # If awaiting confirmation, interpret yes/no/correction
        if state.get("awaiting_confirmation") and state.get("pending_field_index") is not None:
            user_txt = state.get("pending_user_text")
            state["pending_user_text"] = None
            state["messages"] = []
            if user_txt is None:
                return state
            txt = str(user_txt).strip()
            lower = txt.lower()
            yes = any(w in lower for w in ["yes", "y", "correct", "confirm", "ok", "okay"])
            no = any(w in lower for w in ["no", "n", "incorrect", "wrong"])
            pending_idx = int(state["pending_field_index"])
            field_key, _ = FIELDS[pending_idx]
            if yes:
                # Commit
                commit_val = state.get("pending_value") or ""
                state["form"][field_key] = commit_val
                state["next_field_index"] = pending_idx + 1
                state["awaiting_confirmation"] = False
                state["pending_field_index"] = None
                state["pending_value"] = None
                logger.debug("confirm: committed %s='%s' -> next %s", field_key, commit_val, state["next_field_index"])
                return state
            if no:
                # Reject; clear and re-ask same field
                state["awaiting_confirmation"] = False
                state["pending_field_index"] = None
                state["pending_value"] = None
                logger.debug("confirm: rejected suggestion for %s; will re-ask", field_key)
                return state
            # Treat as correction
            corrected = normalize_field_value(field_key, txt)
            state["pending_value"] = corrected
            logger.debug("confirm: updated pending %s to '%s' (awaiting)", field_key, corrected)
            return state

        # Handle form type selection if schema not set
        if not state.get("schema") and not state.get("schema_build_mode"):
            orig_text = state.get("pending_user_text") or ""
            choice = orig_text.strip().lower()
            state["pending_user_text"] = None
            state["messages"] = []
            selected_key = None
            if choice in forms_manifest:
                selected_key = choice
            else:
                # try synonyms
                for k, v in forms_manifest.items():
                    syns = [s.lower() for s in v.get("synonyms", [])]
                    if any(s in choice for s in syns):
                        selected_key = k
                        break
            if not selected_key:
                # Detect if the user's input already looks like a field specification
                looks_like_spec = bool(re.search(r"(:\\s*(text|email|number|date|textarea|select|radio|checkbox))|yes\\s*/\\s*no|\\(([^)]*,[^)]*)\\)|having\\s+options", choice, flags=re.IGNORECASE)) or \
                                   bool(re.search(r"required|optional", choice, flags=re.IGNORECASE)) or \
                                   bool(re.search(r"^[-*]\\s*", orig_text, flags=re.MULTILINE))
                # Enter custom schema build mode
                state["schema_build_mode"] = True
                # Try to derive a form type from a leading '<type> form'
                m_title = re.search(r"([A-Za-z][A-Za-z\s]+?)\s+form", orig_text, flags=re.IGNORECASE)
                derived_type = (m_title.group(1).strip().lower() if m_title else choice or "custom")
                state["proposed_form_type"] = derived_type or "custom"
                if looks_like_spec:
                    # Preserve the original text for immediate parsing in this same turn
                    state["pending_user_text"] = orig_text
                    # fall through into the parsing block below (no return)
                else:
                    return state
            else:
                state["schema"] = forms_manifest[selected_key]
                state["form_type"] = selected_key
                state["next_field_index"] = 0
                logger.debug("Selected schema '%s' with %s fields", selected_key, len(state["schema"].get("fields", [])))
                return state

        # Parse custom schema fields provided by user
        if state.get("schema_build_mode") and not state.get("schema") and state.get("pending_user_text"):
            spec_text = str(state.get("pending_user_text") or "")
            state["pending_user_text"] = None
            state["messages"] = []
            fields: List[Dict[str, Any]] = []
            submit_label: Optional[str] = None
            try:
                # LLM inference first from natural language description
                def llm_infer_schema(description: str) -> Optional[Dict[str, Any]]:
                    if llm is None:
                        return None
                    try:
                        sys = (
                            "You convert a user's natural language form description into a strict JSON schema.\n"
                            "Return ONLY JSON with keys: title (string), fields (array of {key,label,type,required,options?}), submit_label?\n"
                            "- type: one of text,email,number,date,textarea,select,radio,checkbox\n"
                            "- options: for select/radio/checkbox as array of strings\n"
                            "- key: lowercase_with_underscores\n"
                            "Do not include explanations."
                        )
                        user = f"Form description: {description}"
                        resp = llm.invoke([SystemMessage(content=sys), HumanMessage(content=user)])  # type: ignore
                        content = getattr(resp, "content", "")
                        start = content.find("{"); end = content.rfind("}")
                        if start != -1 and end != -1 and end > start:
                            return json.loads(content[start:end+1])
                    except Exception:
                        logger.exception("LLM schema inference failed")
                    return None

                inferred = llm_infer_schema(spec_text)
                if inferred is not None and isinstance(inferred, dict) and isinstance(inferred.get("fields", []), list):
                    state["schema"] = inferred
                    state["form_type"] = (state.get("proposed_form_type") or inferred.get("title") or "custom").replace(" ", "_")
                    state["schema_build_mode"] = False
                    state["next_field_index"] = 0
                    logger.debug("Built custom schema via LLM with %s fields", len(inferred.get("fields", [])))
                    return state

                # Heuristic natural-language parser
                def snake_key(label: str) -> str:
                    return re.sub(r"[^a-z0-9_]+", "_", label.strip().lower().replace(" ", "_")).strip("_")

                def clean_label(text: str) -> str:
                    # Remove phrases like 'as a select with ...', 'radio yes/no', 'text area', 'date'
                    t = re.sub(r"\bas a\b.*$", "", text, flags=re.IGNORECASE)
                    t = re.sub(r"\bwith\b.*$", "", t, flags=re.IGNORECASE)
                    t = re.sub(r"\bradio\b.*$", "", t, flags=re.IGNORECASE)
                    t = re.sub(r"\btext\s*area\b", "", t, flags=re.IGNORECASE)
                    t = re.sub(r"\btext\s*field\b", "", t, flags=re.IGNORECASE)
                    t = re.sub(r"\bdate\b", "", t, flags=re.IGNORECASE)
                    t = re.sub(r"\bdropdown\b", "", t, flags=re.IGNORECASE)
                    t = re.sub(r"\boptional\b", "", t, flags=re.IGNORECASE)
                    t = re.sub(r"\bas\b\.?$", "", t.strip(), flags=re.IGNORECASE)
                    t = re.sub(r"\.$", "", t.strip())
                    t = re.sub(r"\s+", " ", t).strip()
                    return " ".join([w.capitalize() for w in t.split(" ") if w]) or "Field"

                nat_fields: List[Dict[str, Any]] = []
                desc = spec_text
                # Remove noisy prefixes/boilerplate and quotes artefacts
                desc = re.sub(r"parsed\s*fields\s*:\s*", "", desc, flags=re.IGNORECASE)
                desc = re.sub(r"^\s*i will render the\s+'[^']+'\s+with these fields:\s*", "", desc, flags=re.IGNORECASE)
                desc = re.sub(r"reply\s+'?yes'?[\s\S]*$", "", desc, flags=re.IGNORECASE)
                desc = desc.replace("“", '"').replace("”", '"').replace("’", "'")
                # Convert inline dash bullets into newline bullets
                desc = re.sub(r"\s+-\s+", "\n- ", desc)
                # Extract submit label globally (supports 'Submit label should be Send.')
                msub_global = re.search(r"submit\s*label\s*(?:should\s*be|is|:)?\s*([^\.,;\n]+)", desc, flags=re.IGNORECASE)
                if msub_global:
                    submit_label = msub_global.group(1).strip().strip("'\"` ").title()
                # Split description into chunks by newlines, semicolons, sentence breaks, and commas not inside parentheses
                # This preserves option lists inside parentheses, e.g., select (IT, Service Desk, Option3)
                raw_chunks = re.split(r",(?=(?:[^()]*\([^()]*\))*[^()]*$)|\s*(?:\band\b|\n|;|(?<=[\.!\?]))\s+", desc, flags=re.IGNORECASE)
                # additionally split on ") " boundaries (end of meta) followed by a Capitalized field start
                refined_chunks: List[str] = []
                for ck in raw_chunks:
                    if ")" in ck and re.search(r"\)\s+[A-Z]", ck):
                        refined_chunks.extend(re.split(r"\)\s+(?=[A-Z])", ck))
                    else:
                        refined_chunks.append(ck)
                raw_chunks = [c.strip() for c in refined_chunks if c.strip()]
                for chunk in raw_chunks:
                    s = chunk.strip()
                    # Remove leading bullet markers
                    s = re.sub(r"^[-*]\s*", "", s)
                    if not s:
                        continue
                    low = s.lower()
                    # skip submit label chunks (handled globally)
                    if "submit label" in low:
                        continue
                    # Standalone yes/no item -> radio yes/no
                    if re.fullmatch(r"yes\s*/\s*no|yes\s*no|yes\s*or\s*no", low, flags=re.IGNORECASE):
                        nat_fields.append({"key": "confirmation", "label": "Confirmation", "type": "radio", "required": False, "options": ["Yes", "No"]})
                        continue
                    # infer type
                    ftype = "text"
                    options: List[str] = []
                    required = ("required" in low) or ("must" in low and "optional" not in low)

                    # check for explicit metadata in parentheses
                    meta = None
                    mpar = re.search(r"\(([^)]*)\)", s)
                    if mpar:
                        meta = mpar.group(1).strip().lower()
                        if "email" in meta:
                            ftype = "email"
                        elif "number" in meta:
                            ftype = "number"
                        elif "date" in meta or "date picker" in meta:
                            ftype = "date"
                        elif "text area" in meta or "textarea" in meta or "multiline" in meta:
                            ftype = "textarea"
                        elif "password" in meta:
                            ftype = "password"
                        elif "tel" in meta or "phone" in meta:
                            ftype = "tel"
                        elif "select" in meta or "dropdown" in meta:
                            ftype = "select"
                        elif "radio" in meta:
                            ftype = "radio"
                        elif "checkbox" in meta:
                            ftype = "checkbox"
                        if "required" in meta:
                            required = True
                        if "optional" in meta:
                            required = False

                        # Options inside metadata like 'dropdown: Savings, Current'
                        mopts2 = re.search(r"(?:dropdown|select)\s*:\s*([^)]+)", meta)
                        if mopts2:
                            raw = mopts2.group(1)
                            options = [o.strip() for o in re.split(r",|/|\bor\b", raw) if o.strip()]

                    # non-parenthesized cues
                    if ftype == "text":
                        if re.search(r"\bemail\b", low):
                            ftype = "email"
                        elif re.search(r"\bpassword\b", low):
                            ftype = "password"
                        elif re.search(r"\btel\b|\bphone\b|\bphone number\b", low):
                            ftype = "tel"
                        elif re.search(r"\bnumber\b|amount|total|quantity|deposit", low):
                            ftype = "number"
                        elif re.search(r"\bdate\b|last working day|date of birth|dob", low):
                            ftype = "date"
                        elif re.search(r"\btext\s*area\b|\btextarea\b|multiline|comments|description|address", low):
                            ftype = "textarea"
                        elif re.search(r"\bselect\b|\bdropdown\b", low):
                            ftype = "select"
                        elif re.search(r"\bradio\b", low):
                            ftype = "radio"
                        elif re.search(r"\bcheckbox\b|check\s*boxes", low):
                            # If user says 'checkbox' without options, prefer radio yes/no for boolean intent
                            ftype = "checkbox"

                    # parse options
                    if ftype in ("select", "radio", "checkbox"):
                        # look for 'with (Pending, Approved)' or 'with pending/approved' or options in parentheses
                        mparen = re.search(r"\(([^)]+)\)", s)
                        if mparen:
                            raw = mparen.group(1)
                            for token in re.split(r"/|,|\\bor\\b|\\band\\b", raw, flags=re.IGNORECASE):
                                t = token.strip()
                                if t:
                                    options.append(t)
                        mopts = re.search(r"with\s+([\w\-\s/]+)", low)
                        if mopts:
                            raw = mopts.group(1)
                            for token in re.split(r"/|,|\bor\b", raw):
                                t = token.strip()
                                if t:
                                    options.append(t)
                        mhaving = re.search(r"having\s+options?\s+([\w\-\s,\/]+)", low)
                        if mhaving:
                            raw = mhaving.group(1)
                            for token in re.split(r"/|,|\bor\b|\band\b", raw, flags=re.IGNORECASE):
                                t = token.strip()
                                if t:
                                    options.append(t)
                        # If user said 'checkbox' but no options were parsed, treat as boolean yes/no
                        if ftype == "checkbox" and not options:
                            ftype = "radio"
                            options = ["Yes", "No"]
                        if re.search(r"yes\s*/\s*no|yes\s*no", low):
                            options = ["yes", "no"]
                        if re.search(r"fiscal year", low) and not options:
                            from datetime import datetime
                            y = datetime.utcnow().year
                            options = [f"FY{y-1}-{y}", f"FY{y}-{y+1}", f"FY{y+1}-{y+2}"]
                        # If options were found but type remained text, upgrade to select
                        if not (ftype in ("select", "radio", "checkbox")) and options:
                            ftype = "select"

                    # derive label and key
                    label_src = s.split("(")[0] if "(" in s else s
                    label = clean_label(label_src)
                    key = snake_key(label)
                    field: Dict[str, Any] = {"key": key, "label": label, "type": ftype, "required": required}
                    if options:
                        field["options"] = options
                    nat_fields.append(field)

                # If we recognized natural fields, use them
                if nat_fields:
                    schema = {"title": state.get("proposed_form_type") or "custom", "fields": nat_fields}
                    if submit_label:
                        schema["submit_label"] = submit_label
                    state["schema"] = schema
                    state["form_type"] = (state.get("proposed_form_type") or "custom").replace(" ", "_")
                    state["schema_build_mode"] = False
                    state["next_field_index"] = 0
                    logger.debug("Built custom schema via heuristics with %s fields", len(nat_fields))
                    return state

                # Fallback: split by commas not inside parentheses and parse key:type:required(options)
                parts = re.split(r",(?=(?:[^()]*\([^()]*\))*[^()]*$)", spec_text)
                for p in parts:
                    s = p.strip()
                    if not s:
                        continue
                    # submit label
                    if s.lower().startswith("submit_label:"):
                        submit_label = s.split(":", 1)[1].strip()
                        continue
                    # pattern: key:type:required(options)
                    m = re.match(r"^([a-zA-Z0-9_\-]+)\s*:\s*([a-zA-Z]+)(?::\s*(required))?(?:\(([^)]*)\))?$", s)
                    if not m:
                        # allow key only -> default text
                        key_only = s
                        label = " ".join(key_only.replace("_", " ").replace("-", " ").split()).title()
                        fields.append({"key": key_only, "label": label, "type": "text", "required": False})
                        continue
                    key, ftype, reqflag, opts = m.groups()
                    ftype = ftype.lower()
                    required = (reqflag is not None)
                    label = " ".join(key.replace("_", " ").replace("-", " ").split()).title()
                    field: Dict[str, Any] = {"key": key, "label": label, "type": ftype, "required": required}
                    if opts:
                        options = [o.strip() for o in opts.split(";") for o in o.split(",") if o.strip()]
                        if options:
                            field["options"] = options
                    fields.append(field)
                if not fields:
                    return state
                schema = {"title": state.get("proposed_form_type") or "custom", "fields": fields}
                if submit_label:
                    schema["submit_label"] = submit_label
                state["schema"] = schema
                state["form_type"] = (state.get("proposed_form_type") or "custom").replace(" ", "_")
                state["schema_build_mode"] = False
                state["next_field_index"] = 0
                logger.debug("Built custom schema with %s fields", len(fields))
                return state
            except Exception:
                logger.exception("Failed parsing custom schema spec")
                return state

        # If schema not confirmed, parse confirmation or change commands (LLM-assisted NLP + flexible phrasing)
        if not state.get("schema_confirmed"):
            txt = (state.get("pending_user_text") or "").strip()
            state["pending_user_text"] = None
            state["messages"] = []
            if not txt:
                return state
            low = txt.lower()
            # First try an NLP-based classifier if LLM is available
            def classify_confirmation_intent(text: str) -> Optional[str]:
                if llm is None:
                    return None
                try:
                    sys = (
                        "You are an intent classifier for a form schema review step.\n"
                        "Decide whether the user confirms the schema or wants changes.\n"
                        "Respond with EXACTLY ONE TOKEN from this set: YES, CHANGE, AMBIGUOUS.\n"
                        "Definitions:\n- YES: user is satisfied and wants to proceed/start filling (e.g., yes, okay, looks good, proceed, I'm done, no changes).\n"
                        "- CHANGE: user wants edits (e.g., no, change, edit, modify, remove/add fields, update theme).\n"
                        "- AMBIGUOUS: unclear."
                    )
                    examples = [
                        ("yes", "YES"),
                        ("I'm done", "YES"),
                        ("looks good, proceed", "YES"),
                        ("no", "CHANGE"),
                        ("let's remove urgency", "CHANGE"),
                        ("add field amount:number:required", "CHANGE"),
                        ("maybe", "AMBIGUOUS"),
                    ]
                    fewshot = []
                    for u, a in examples:
                        fewshot.append(HumanMessage(content=f"User: {u}"))
                        fewshot.append(AIMessage(content=a))
                    msg = [SystemMessage(content=sys)] + fewshot + [HumanMessage(content=f"User: {text}")]
                    resp = llm.invoke(msg)  # type: ignore
                    content = getattr(resp, "content", "").strip().upper()
                    if content in {"YES", "CHANGE", "AMBIGUOUS"}:
                        return content
                except Exception:
                    logger.exception("LLM classify confirmation failed")
                return None

            label = classify_confirmation_intent(txt)
            if label == "YES":
                state["schema_confirmed"] = True
                logger.debug("Schema confirmed by user (LLM classifier)")
                return state
            if label == "CHANGE":
                logger.debug("User requested schema changes (LLM classifier); waiting for specifics")
                state["awaiting_schema_changes"] = True
                return state
            # Flexible yes/no understanding
            def contains_any(text: str, patterns: List[str]) -> bool:
                for pat in patterns:
                    if re.search(pat, text, flags=re.IGNORECASE):
                        return True
                return False
            yes_patterns = [
                r"\b(yes|y)\b",
                r"\b(ok|okay)\b",
                r"\b(confirm(ed)?|confirmed)\b",
                r"\b(looks (good|fine)|good to go|all good)\b",
                r"\b(proceed|continue|go ahead|start (now|filling)|ready)\b",
                r"\b(i'?m done|i am done|done)\b",
                r"\b(no changes?|no change needed)\b",
                r"(don't|do not) change anything",
                r"\bkeep( it)?( as is)?\b",
                r"i don'?t want to make any change",
                r"i do not want to make any change",
            ]
            no_patterns = [
                r"\b(no|n)\b",
                r"\b(change|edit|modify|revise|update)\b",
                r"\b(want|need) to (make|do) (some|few|any)?\s*changes\b",
                r"\b(make|do) (some|few|any)?\s*changes\b",
                r"\bfew changes\b|\bsome changes\b|\bminor changes\b|\bsmall changes\b",
                r"(don't|do not) (proceed|continue)",
                r"\b(not good|don'?t like)\b",
            ]
            if contains_any(low, yes_patterns):
                state["schema_confirmed"] = True
                logger.debug("Schema confirmed by user (flexible match)")
                return state
            if contains_any(low, no_patterns):
                logger.debug("User requested schema changes (flexible match); waiting for specifics")
                state["awaiting_schema_changes"] = True
                return state
            # Simple command parsing
            # theme {json}
            if "theme" in low and "{" in txt and "}" in txt:
                try:
                    json_start = txt.index("{")
                    json_end = txt.rindex("}") + 1
                    obj = json.loads(txt[json_start:json_end])
                    if isinstance(obj, dict):
                        state["theme"] = obj
                        logger.debug("Applied theme update: %s", obj)
                        return state
                except Exception:
                    logger.exception("Failed to parse theme JSON")
                    return state
            # add field key[:type[:required]]
            if low.startswith("add field"):
                try:
                    parts = txt.split()
                    spec = parts[2] if len(parts) > 2 else ""
                    segs = spec.split(":")
                    key = segs[0]
                    ftype = (segs[1] if len(segs) > 1 else "text").lower()
                    req = (segs[2].lower() == "required") if len(segs) > 2 else False
                    label = " ".join(key.replace("_", " ").replace("-", " ").split()).title()
                    new_f = {"key": key, "label": label, "type": ftype, "required": req}
                    state["schema"]["fields"].append(new_f)  # type: ignore
                    logger.debug("Added field: %s", new_f)
                except Exception:
                    logger.exception("Failed to add field from spec: %s", txt)
                return state
            if low.startswith("remove field"):
                try:
                    # Capture everything after 'remove field '
                    m = re.search(r"remove\s+field\s+(.+)$", txt, flags=re.IGNORECASE)
                    name_raw = m.group(1).strip() if m else (txt.split(maxsplit=2)[2] if len(txt.split()) > 2 else "")
                    # Normalize to a key-like form (snake)
                    name_key = re.sub(r"[^a-z0-9_]+", "_", name_raw.strip().lower().replace(" ", "_")).strip("_")
                    name_label_lower = " ".join(name_raw.strip().lower().split())
                    fields = state["schema"]["fields"]  # type: ignore
                    new_fields = []
                    removed = []
                    for f in fields:
                        fk = str(f.get("key", "")).strip().lower()
                        fl = str(f.get("label", "")).strip().lower()
                        fl_norm = " ".join(fl.split())
                        if fk == name_key or fl_norm == name_label_lower:
                            removed.append(f)
                            continue
                        new_fields.append(f)
                    state["schema"]["fields"] = new_fields  # type: ignore
                    logger.debug("Removed fields matching '%s' (key=%s): %s", name_raw, name_key, len(removed))
                except Exception:
                    logger.exception("Failed to remove field from spec: %s", txt)
                return state
            # Unrecognized change command; ignore
            return state

        # Not awaiting: capture input and propose suggestion
        # Use schema-driven field lookup
        field_key, _ = FIELDS[idx]
        if state.get("schema") and isinstance(state["schema"], dict):
            sf = state["schema"].get("fields", [])
            if 0 <= idx < len(sf):
                field_key = sf[idx].get("key", field_key)
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

        # Try LLM suggestion first, then heuristic normalization
        suggestion = llm_extract_field_suggestion(field_key, str(content))
        normalized = normalize_field_value(field_key, suggestion or str(content))
        # Update form live for better binding UX; still ask for confirmation
        state.setdefault("form", {})[field_key] = normalized
        state["awaiting_confirmation"] = True
        state["pending_field_index"] = idx
        state["pending_value"] = normalized
        # Clear transient inputs and messages so checkpoints never hold messages
        state["pending_user_text"] = None
        state["messages"] = []
        logger.debug("process_user: suggested %s='%s', awaiting confirmation", field_key, normalized)
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

