import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { HttpAgent, RunAgentInput, EventType } from '@ag-ui/client';

export interface AguiMessage {
  role: 'assistant' | 'user';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class AguiService {
  private agent = new HttpAgent({ url: 'http://localhost:8000/agent' });

  readonly threadId$ = new BehaviorSubject<string | null>(null);
  readonly messages$ = new BehaviorSubject<AguiMessage[]>([]);
  readonly state$ = new BehaviorSubject<Record<string, any>>({});
  readonly loading$ = new BehaviorSubject<boolean>(false);

  // De-dup guards for snapshot-driven UI updates
  private turnHasTextStream = false;
  private lastSnapshotHash: string | null = null;
  private started = false;
  private lastSentHash: string | null = null;
  private lastSentAt = 0;
  private lastAssistantText: string | null = null;
  private lastAssistantId: string | null = null;
  private lastUserText: string | null = null;
  private lastUserId: string | null = null;
  private sawAssistantThisTurn = false;
  // Loading/progress handling
  private minLoadingMs = 1500;
  private loadingStartedAt = 0;
  private loadingStopTimer: any = null;

  private uuid(): string {
    try { return (crypto as any).randomUUID(); } catch { return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  }

  start(threadId?: string) {
    if (this.started) return;
    this.started = true;
    this.beginLoading();
    const tid = threadId || this.threadId$.value || this.uuid();
    this.threadId$.next(tid);
    const runInput: any = {
      threadId: tid,
      runId: this.uuid(),
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: { node_name: "entry_cleanup", command: {} }
    };
    const events$ = (this.agent as any).run(runInput);
    (events$ as any).subscribe((e: any) => this.onEvent(e));
  }

  send(text: string) {
    const tid = this.threadId$.value || this.uuid();
    this.threadId$.next(tid);
    // Debounce duplicate rapid sends of identical text
    const now = Date.now();
    const hash = `user:${text}`;
    if (this.lastSentHash === hash && now - this.lastSentAt < 1200) return;
    this.lastSentHash = hash;
    this.lastSentAt = now;
    // Optimistically render user's message (server will not echo human messages in this flow)
    this.appendMessage({ role: 'user', text });

    // Do NOT optimistically render here; wait for server echoes to avoid dupes
    const runInput: any = {
      threadId: tid,
      runId: this.uuid(),
      state: { pending_user_text: text },
      messages: [],
      tools: [],
      context: [],
      forwardedProps: { node_name: "entry_cleanup", command: {} }
    };
    this.beginLoading();
    const events$ = (this.agent as any).run(runInput);
    (events$ as any).subscribe((e: any) => this.onEvent(e));
  }

  private appendMessage(m: AguiMessage) {
    const arr = this.messages$.value.slice();
    arr.push(m);
    this.messages$.next(arr);
  }
  private onEvent(e: any) {
    switch (e.type) {
      case EventType.RUN_STARTED:
        if (e.thread_id) this.threadId$.next(e.thread_id);
        this.turnHasTextStream = false;
        // Do not reset lastSnapshotHash here; keep across runs to avoid re-appending identical prompts
        this.sawAssistantThisTurn = false;
        this.beginLoading();
        break;
      case EventType.TEXT_MESSAGE_START: {
        this.turnHasTextStream = true;
        const msgsNow = this.messages$.value;
        const lastMsg = msgsNow[msgsNow.length - 1];
        if (!(lastMsg && lastMsg.role === 'assistant')) {
          this.appendMessage({ role: 'assistant', text: '' });
        }
        this.sawAssistantThisTurn = true;
        break;
      }
      case EventType.TEXT_MESSAGE_CONTENT: {
        const msgsNow = this.messages$.value.slice();
        if (msgsNow.length > 0) {
          const last = msgsNow[msgsNow.length - 1];
          if (last.role === 'assistant') {
            const delta = String(e.delta || '');
            // Suppress canned intro text from server
            const lowered = delta.toLowerCase();
            const isIntroChunk = lowered.includes("helpdesk assistant") ||
                                 lowered.includes("here are some requests i can create") ||
                                 lowered.includes("tell me which one you want");
            if (!isIntroChunk) {
              last.text += delta;
            }
            this.lastAssistantText = last.text || null;
          }
          this.messages$.next(msgsNow);
        }
        break;
      }
      case EventType.STATE_SNAPSHOT: {
        // Merge rawEvent output/input (always merge form if present)
        const prev = (this.state$.value || {}) as any;
        const next: any = { ...prev };
        const raw = (e.rawEvent?.data?.output || e.rawEvent?.data?.input || {}) as any;
        if (raw && typeof raw === 'object') {
          if (raw.form) next.form = { ...(prev.form || {}), ...raw.form };
          if (typeof raw.next_field_index === 'number') next.next_field_index = raw.next_field_index;
          if (typeof raw.asked_index === 'number') next.asked_index = raw.asked_index;
          if (raw.schema) next.schema = raw.schema;
          if (raw.form_type) next.form_type = raw.form_type;
          if (raw.theme) next.theme = raw.theme;
          if (typeof raw.schema_confirmed === 'boolean') next.schema_confirmed = raw.schema_confirmed;
          if (raw.card) next.card = raw.card;
          if (typeof raw.schema_build_mode === 'boolean') next.schema_build_mode = raw.schema_build_mode;
        }
        if (e.snapshot && typeof e.snapshot === 'object') {
          // Some adapters put state at root or under snapshot.state
          const snap: any = e.snapshot as any;
          const sstate: any = (snap && typeof snap.state === 'object') ? snap.state : snap;
          // Merge structural state if present
          if (sstate) {
            if (sstate.form && typeof sstate.form === 'object') {
              next.form = { ...(prev.form || {}), ...(sstate.form || {}) };
            }
            if (typeof sstate.next_field_index === 'number') next.next_field_index = sstate.next_field_index;
            if (typeof sstate.asked_index === 'number') next.asked_index = sstate.asked_index;
            if (sstate.schema) next.schema = sstate.schema;
            if (sstate.form_type) next.form_type = sstate.form_type;
            if (sstate.theme) next.theme = sstate.theme;
            if (typeof sstate.schema_confirmed === 'boolean') next.schema_confirmed = sstate.schema_confirmed;
            if (sstate.card) next.card = sstate.card;
            if (typeof sstate.schema_build_mode === 'boolean') next.schema_build_mode = sstate.schema_build_mode;
          }
          // Also sync messages if provided
          const msgs = (snap as any).messages || (sstate && (sstate as any).messages);
          if (Array.isArray(msgs)) next.messages = msgs;
        }
        this.state$.next(next);
        // Fallback to render assistant message if none streamed yet this turn
        if (!this.sawAssistantThisTurn) {
          const msgs = (e.snapshot?.messages || []) as any[];
          if (Array.isArray(msgs) && msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            const t = last?.type;
            const content = last?.content ?? '';
            const role = t === 'human' ? 'user' : t === 'ai' ? 'assistant' : null as any;
            if (role === 'assistant') {
              const norm = String(content || '').trim();
              const normLower = norm.toLowerCase();
              const intro = normLower.includes("helpdesk assistant") ||
                            normLower.includes("here are some requests i can create") ||
                            normLower.includes("tell me which one you want");
              const hash = `${role}:${norm}`;
              if (!intro && this.lastSnapshotHash !== hash) {
                const current = this.messages$.value;
                const lastMsg = current[current.length - 1];
                if (!(lastMsg && lastMsg.role === role && lastMsg.text.trim() === norm)) {
                  this.appendMessage({ role, text: content });
                }
                this.lastSnapshotHash = hash;
                this.lastAssistantText = content;
                this.lastAssistantId = last?.id || null;
                this.sawAssistantThisTurn = true;
              }
            }
          }
        }
        break;
      }
      case EventType.MESSAGES_SNAPSHOT: {
        const msgs = (e.messages || []) as any[];
        if (Array.isArray(msgs) && !this.sawAssistantThisTurn && msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          const role = last?.role;
          const text = last?.content ?? '';
          if (role === 'assistant') {
            const norm = String(text || '').trim();
            const normLower = norm.toLowerCase();
            const intro = normLower.includes("helpdesk assistant") ||
                          normLower.includes("here are some requests i can create") ||
                          normLower.includes("tell me which one you want");
            const hash = `${role}:${norm}`;
            if (!intro && this.lastSnapshotHash !== hash) {
              const current = this.messages$.value;
              const lastMsg = current[current.length - 1];
              if (!(lastMsg && lastMsg.role === role && lastMsg.text.trim() === norm)) {
                this.appendMessage({ role, text });
              }
              this.lastSnapshotHash = hash;
              this.lastAssistantText = text;
              this.lastAssistantId = last?.id || null;
              this.sawAssistantThisTurn = true;
            }
          }
        } else if (Array.isArray(msgs) && msgs.length > 0) {
          // Keep assistant tracking in sync even if stream handled UI
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            this.lastAssistantText = last?.content ?? '';
            this.lastAssistantId = last?.id || null;
          }
        }
        break;
      }
      default:
        break;
      case EventType.RUN_FINISHED:
        // allow new sends after run finishes
        this.turnHasTextStream = false;
        this.sawAssistantThisTurn = false;
        this.endLoading();
        break;
    }
  }

  private beginLoading() {
    if (this.loadingStopTimer) {
      clearTimeout(this.loadingStopTimer);
      this.loadingStopTimer = null;
    }
    this.loadingStartedAt = Date.now();
    if (!this.loading$.value) this.loading$.next(true);
  }

  private endLoading() {
    const elapsed = Date.now() - this.loadingStartedAt;
    const remain = this.minLoadingMs - elapsed;
    const delay = remain > 0 ? remain : 0;
    if (this.loadingStopTimer) clearTimeout(this.loadingStopTimer);
    this.loadingStopTimer = setTimeout(() => {
      this.loading$.next(false);
      this.loadingStopTimer = null;
    }, delay);
  }
}
