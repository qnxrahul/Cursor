import { TestBed } from '@angular/core/testing';
import { AguiService } from './agui.service';
import { EventType } from '@ag-ui/client';

describe('AguiService', () => {
  let service: AguiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AguiService);
  });

  it('renders only one initial assistant question per turn (snapshot or stream)', () => {
    const rendered: { role: 'assistant'|'user'; text: string }[] = [];
    service.messages$.subscribe(m => { rendered.length = 0; rendered.push(...m); });

    // Simulate RUN_STARTED
    (service as any).onEvent({ type: EventType.RUN_STARTED, thread_id: 't1' });

    // Simulate MESSAGES_SNAPSHOT with assistant message (fallback path)
    (service as any).onEvent({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ role: 'assistant', content: 'Please provide your full name.' }]
    });
    expect(rendered.filter(x => x.role === 'assistant').length).toBe(1);

    // Simulate TEXT_MESSAGE_START (should not add a second bubble this turn)
    (service as any).onEvent({ type: EventType.TEXT_MESSAGE_START });
    expect(rendered.filter(x => x.role === 'assistant').length).toBe(1);
  });
});

