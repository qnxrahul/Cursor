import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { HttpAgent, RunAgentInput, EventType, type BaseEvent } from '@ag-ui/client';

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

  start(threadId?: string) {
    const runInput: RunAgentInput = {
      thread_id: threadId || undefined,
      messages: [],
    } as any;
    const events$ = this.agent.run(runInput);
    this.subscribeToEvents(events$);
  }

  send(text: string) {
    const runInput: RunAgentInput = {
      thread_id: this.threadId$.value || undefined,
      messages: [
        { role: 'user', content: text },
      ] as any,
    } as any;
    const events$ = this.agent.run(runInput);
    this.subscribeToEvents(events$);
  }
  private subscribeToEvents(events$: import('rxjs').Observable<BaseEvent>) {
    events$.subscribe((e: any) => {
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
          break;
        }
        default:
          break;
      }
    });
  }
}

