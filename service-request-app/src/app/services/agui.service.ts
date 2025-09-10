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

  private uuid(): string {
    try { return (crypto as any).randomUUID(); } catch { return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  }

  start(threadId?: string) {
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
  private onEvent(e: any) {
    switch (e.type) {
      case EventType.RUN_STARTED:
        if (e.thread_id) this.threadId$.next(e.thread_id);
        break;
      case EventType.TEXT_MESSAGE_START: {
        const msgs = this.messages$.value;
        this.messages$.next([...msgs, { role: 'assistant', text: '' }]);
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
        // Fallback: if no text streaming, try to reflect last assistant/user from LC-style snapshot
        const msgs = (e.snapshot?.messages || []) as any[];
        if (Array.isArray(msgs) && msgs.length > 0) {
          const mapped = msgs
            .map((m: any) => {
              const t = m?.type;
              if (t === 'human') return { role: 'user', text: m?.content ?? '' };
              if (t === 'ai') return { role: 'assistant', text: m?.content ?? '' };
              return null;
            })
            .filter(Boolean) as AguiMessage[];
          if (mapped.length) this.messages$.next(mapped);
        }
        break;
      }
      case EventType.MESSAGES_SNAPSHOT: {
        const msgs = (e.messages || []) as any[];
        if (Array.isArray(msgs)) {
          const mapped = msgs
            .map((m: any) => {
              const role = m?.role;
              if (role === 'user' || role === 'assistant') {
                return { role, text: m?.content ?? '' } as AguiMessage;
              }
              return null;
            })
            .filter(Boolean) as AguiMessage[];
          if (mapped.length) this.messages$.next(mapped);
        }
        break;
      }
      default:
        break;
    }
  }
}

