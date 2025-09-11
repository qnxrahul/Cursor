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

  private uuid(): string {
    try { return (crypto as any).randomUUID(); } catch { return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  }

  start(threadId?: string) {
    if (this.started) return;
    this.started = true;
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
        this.lastSnapshotHash = null;
        this.sawAssistantThisTurn = false;
        break;
      case EventType.TEXT_MESSAGE_START: {
        // Prefer snapshot-based rendering to avoid duplicates; do not append here
        this.turnHasTextStream = true;
        break;
      }
      case EventType.TEXT_MESSAGE_CONTENT: {
        // Skip streaming deltas; snapshots will render the final assistant text once
        break;
      }
      case EventType.STATE_SNAPSHOT: {
        // Merge rawEvent.output/input keys like form, next_field_index in addition to snapshot
        const prev = (this.state$.value || {}) as any;
        const next: any = { ...prev };
        const rawOut = (e.rawEvent?.data?.output || {}) as any;
        const rawIn = (e.rawEvent?.data?.input || {}) as any;
        // Determine if this STATE_SNAPSHOT corresponds to processing a human reply
        let lastInputRole: 'user'|'assistant'|null = null;
        const inMsgs = (rawIn?.messages || []) as any[];
        if (Array.isArray(inMsgs) && inMsgs.length > 0) {
          const lastIn = inMsgs[inMsgs.length - 1];
          const t = lastIn?.type;
          const r = lastIn?.role;
          lastInputRole = r ? (r as any) : (t === 'human' ? 'user' : t === 'ai' ? 'assistant' : null);
        }
        // Only merge form when a human input was processed; prevents binding prompts to fields
        if (rawOut && typeof rawOut === 'object') {
          if (lastInputRole === 'user' && rawOut.form) next.form = { ...(prev.form || {}), ...rawOut.form };
          if (typeof rawOut.next_field_index === 'number') next.next_field_index = rawOut.next_field_index;
          if (typeof rawOut.asked_index === 'number') next.asked_index = rawOut.asked_index;
        }
        if (e.snapshot && typeof e.snapshot === 'object') {
          // e.snapshot often only includes messages/tools; keep merge minimal
          if (Array.isArray((e.snapshot as any).messages)) next.messages = (e.snapshot as any).messages;
        }
        this.state$.next(next);
        break;
      }
      case EventType.MESSAGES_SNAPSHOT: {
        const msgs = (e.messages || []) as any[];
        if (Array.isArray(msgs) && msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          const role = last?.role;
          const text = last?.content ?? '';
          if (role === 'assistant') {
            const norm = String(text || '').trim();
            const hash = `${role}:${norm}`;
            if (this.lastSnapshotHash !== hash) {
              const current = this.messages$.value;
              const lastMsg = current[current.length - 1];
              if (!(lastMsg && lastMsg.role === role && lastMsg.text.trim() === norm)) {
                this.appendMessage({ role, text });
              }
              this.lastSnapshotHash = hash;
              this.lastAssistantText = text;
              this.lastAssistantId = last?.id || null;
            }
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
        break;
    }
  }
}
