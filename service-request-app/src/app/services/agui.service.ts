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

  async start(threadId?: string) {
    const runInput: RunAgentInput = {
      thread_id: threadId || undefined,
      messages: [],
    } as any;

    const stream = await this.agent.runAgent(runInput);
    this.streamEvents(stream);
  }

  async send(text: string) {
    const runInput: RunAgentInput = {
      thread_id: this.threadId$.value || undefined,
      messages: [
        { role: 'user', content: text },
      ] as any,
    } as any;
    const stream = await this.agent.runAgent(runInput);
    this.streamEvents(stream);
  }

  private streamEvents(stream: AsyncIterable<any>) {
    (async () => {
      for await (const e of stream) {
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
          case EventType.MESSAGES_SNAPSHOT: {
            // Optional: sync full transcript if needed
            break;
          }
          case EventType.STATE_SNAPSHOT: {
            if (e.snapshot) this.state$.next(e.snapshot as any);
            break;
          }
          case EventType.RUN_FINISHED:
          default:
            break;
        }
      }
    })();
  }
}

