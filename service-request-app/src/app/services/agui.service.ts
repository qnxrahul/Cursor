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
    // Optimistically show user text to avoid visual clearing
    this.appendMessage({ role: 'user', text });
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
        break;
      case EventType.TEXT_MESSAGE_START: {
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
        // Fallback: append last LC-style message (do not overwrite transcript)
        const msgs = (e.snapshot?.messages || []) as any[];
        if (Array.isArray(msgs) && msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          const t = last?.type;
          const content = last?.content ?? '';
          if (t === 'human') this.appendMessage({ role: 'user', text: content });
          else if (t === 'ai') this.appendMessage({ role: 'assistant', text: content });
        }
        break;
      }
      case EventType.MESSAGES_SNAPSHOT: {
        const msgs = (e.messages || []) as any[];
        if (Array.isArray(msgs)) {
          const last = msgs[msgs.length - 1];
          const role = last?.role;
          const text = last?.content ?? '';
          if (role === 'user' || role === 'assistant') this.appendMessage({ role, text });
        }
        break;
      }
      default:
        break;
    }
  }
}

