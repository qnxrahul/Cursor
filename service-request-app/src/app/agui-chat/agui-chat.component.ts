import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AguiService } from '../services/agui.service';

@Component({
  selector: 'app-agui-chat',
  templateUrl: './agui-chat.component.html'
})
export class AguiChatComponent implements OnInit, OnDestroy {
  input = '';
  state: any = {};
  private sub?: Subscription;
  showCustomizer = false;
  private awaitingFieldSpec = false;
  // Known requests (should mirror backend manifest keys)
  requests = [
    { key: 'service_auth', label: 'Service Authorization Request' },
    { key: 'exit_request', label: 'Exit Request' },
    { key: 'reimbursement', label: 'Reimbursement Request' },
    { key: 'bonafide_certificate', label: 'Bonafide Certificate Request' }
  ];

  constructor(public agui: AguiService) {}

  ngOnInit(): void {
    this.sub = this.agui.state$.subscribe(s => { this.state = s || {}; });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  send() {
    const t = this.input.trim();
    if (!t) return;

    // If we previously asked for field specs, forward them to backend as a creation request
    if (this.awaitingFieldSpec) {
      const prompt = `Create a dynamic form with these fields: ${t}`;
      this.agui.send(prompt);
      this.awaitingFieldSpec = false;
      this.input = '';
      return;
    }

    // Detect intent to create a new form type and prompt for field details
    const lower = t.toLowerCase();
    const asksNewForm = lower.includes('new type of form') || lower.includes('create a dynamic form') || lower.includes('new form');
    if (asksNewForm) {
      // Append user's message and assistant guidance locally without hitting backend yet
      const msgs = this.agui.messages$.value.slice();
      msgs.push({ role: 'user', text: t });
      msgs.push({ role: 'assistant', text: 'Sure — please share the field names and types (e.g., text, number, date, radio, checkbox, select, textarea). For example: name:text, age:number, start_date:date, department:select[HR,Finance,IT].' });
      this.agui.messages$.next(msgs);
      this.awaitingFieldSpec = true;
      this.input = '';
      return;
    }

    this.agui.send(t);
    this.input = '';
  }

  choose(key: string) {
    this.agui.send(key);
  }

  get showWelcome(): boolean {
    // Show welcome chooser if no schema chosen yet
    return !this.state?.schema;
  }

  toggleCustomizer() {
    this.showCustomizer = !this.showCustomizer;
  }

  clearFields() {
    const prev = this.agui.state$.value || {};
    const next = { ...prev, form: {} };
    this.agui.state$.next(next);
  }

  private isIntroText(text: string): boolean {
    const t = (text || '').toLowerCase();
    return t.includes("helpdesk assistant") ||
           t.includes("tell me which one you want") ||
           t.includes("service authorization request") ||
           t.includes("exit request") ||
           t.includes("reimbursement") ||
           t.includes("bonafide certificate");
  }
}

