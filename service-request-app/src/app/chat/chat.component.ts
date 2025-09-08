import { Component } from '@angular/core';
import { AgentService, StartChatResponse, RespondResponse } from '../services/agent.service';

interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html'
})
export class ChatComponent {
  messages: ChatMessage[] = [];
  userInput = '';
  threadId: string | null = null;
  currentFieldKey: string | null = null;

  constructor(private agent: AgentService) {
    this.start();
  }

  start(): void {
    this.agent.start().subscribe((res: StartChatResponse) => {
      this.threadId = res.thread_id;
      this.currentFieldKey = res.field_key;
      this.messages = [{ role: 'agent', text: res.message }];
    });
  }

  send(): void {
    const text = this.userInput.trim();
    if (!text || !this.threadId) return;
    this.messages.push({ role: 'user', text });
    this.userInput = '';
    this.agent.respond({ thread_id: this.threadId, message: text }).subscribe((res: RespondResponse) => {
      if (res.message) this.messages.push({ role: 'agent', text: res.message });
      this.currentFieldKey = res.field_key ?? null;
      if (res.done && res.form) {
        this.messages.push({ role: 'agent', text: 'All details collected. You can submit the form.' });
      }
    });
  }
}

