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
      forwardedProps: {}
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
    // Do NOT optimistically render here; wait for server echoes to avoid dupes
    const runInput: any = {
      threadId: tid,
      runId: this.uuid(),
      state: {},
      messages: [
        { id: this.uuid(), role: 'user', content: text },
      ],
      tools: [],
      context: [],
      forwardedProps: {}
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
        break;
      case EventType.TEXT_MESSAGE_START: {
        this.turnHasTextStream = true;
        this.appendMessage({ role: 'assistant', text: '' });
        break;
      }
      case EventType.TEXT_MESSAGE_CONTENT: {
        const msgs = this.messages$.value.slice();
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          if (last.role === 'assistant') last.text += e.delta || '';
          this.messages$.next(msgs);
        }
        break;
      }
      case EventType.STATE_SNAPSHOT: {
        if (e.snapshot) this.state$.next(e.snapshot as any);
        // Fallback: append last LC-style message (skip if text stream already handled this turn)
        if (this.turnHasTextStream) break;
        const msgs = (e.snapshot?.messages || []) as any[];
        if (Array.isArray(msgs) && msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          const t = last?.type;
          const content = last?.content ?? '';
          const role = t === 'human' ? 'user' : t === 'ai' ? 'assistant' : null as any;
          if (role === 'user' || role === 'assistant') {
            const hash = `${role}:${content}`;
            if (this.lastSnapshotHash !== hash) {
              this.appendMessage({ role, text: content });
              this.lastSnapshotHash = hash;
            }
          }
        }
        break;
      }
      case EventType.MESSAGES_SNAPSHOT: {
        const msgs = (e.messages || []) as any[];
        if (Array.isArray(msgs)) {
          if (this.turnHasTextStream) break;
          const last = msgs[msgs.length - 1];
          const role = last?.role;
          const text = last?.content ?? '';
          if (role === 'user' || role === 'assistant') {
            const hash = `${role}:${text}`;
            if (this.lastSnapshotHash !== hash) {
              this.appendMessage({ role, text });
              this.lastSnapshotHash = hash;
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
        break;
    }
  }
}

