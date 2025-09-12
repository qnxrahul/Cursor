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
  awaitingFieldSpec = false;
  hasUserResponded = false;
  userDeclined = false;
  awaitingYesNo = false;
  optionsAllowed = false;
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
    // Seed initial assistant greeting if no messages yet
    const existing = this.agui.messages$.value || [];
    if (existing.length === 0) {
      this.agui.messages$.next([{ role: 'assistant', text: 'Hi, how may I help you?' }]);
    }
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  send() {
    const t = this.input.trim();
    if (!t) return;
    this.hasUserResponded = true;
    const lower = t.toLowerCase();

    // Handle outstanding yes/no prompt
    if (this.awaitingYesNo) {
      const affirmative = this.isAffirmative(t);
      const negative = this.isNegative(t);
      const msgs = this.agui.messages$.value.slice();
      msgs.push({ role: 'user', text: t });
      if (affirmative) {
        msgs.push({ role: 'assistant', text: 'Great — please choose a request below or describe a new form.' });
        this.awaitingYesNo = false;
        this.userDeclined = false;
        this.optionsAllowed = true;
      } else if (negative) {
        msgs.push({ role: 'assistant', text: 'I am limited to creating different IT service requests and dynamic form generation.' });
        this.awaitingYesNo = false;
        this.userDeclined = true;
        this.optionsAllowed = false;
      } else {
        msgs.push({ role: 'assistant', text: "Please reply 'yes' to continue or 'no' to cancel." });
      }
      this.agui.messages$.next(msgs);
      this.input = '';
      return;
    }

    // If we previously asked for field specs, forward them to backend as a creation request
    if (this.awaitingFieldSpec) {
      const prompt = `Create a dynamic form with these fields: ${t}`;
      // Signal backend that schema is requested; form component will show submit after confirmation
      this.agui.send(prompt);
      this.awaitingFieldSpec = false;
      // Allow submit once fields are provided to generate the form
      const prev = this.agui.state$.value || {};
      this.agui.state$.next({ ...prev, allow_submit: true });
      this.input = '';
      return;
    }

    // If input matches a known request, route to backend immediately
    const reqKeyEarly = this.parseRequestKey(lower);
    if (reqKeyEarly) {
      this.agui.send(reqKeyEarly);
      this.optionsAllowed = false;
      this.input = '';
      return;
    }

    // Detect intent to create a new custom form (e.g., "I need policy form")
    const asksNewForm = this.isDynamicFormIntent(lower);
    if (asksNewForm) {
      // Append user's message and assistant guidance locally without hitting backend yet
      const msgs = this.agui.messages$.value.slice();
      msgs.push({ role: 'user', text: t });
      msgs.push({ role: 'assistant', text: 'Sure — what fields do you want to add and any CSS preferences (primary, accent, card background, text color, corner radius, font)? For example: name:text, age:number, start_date:date, department:select[HR,Finance,IT].' });
      this.agui.messages$.next(msgs);
      this.awaitingFieldSpec = true;
      this.optionsAllowed = false;
      this.input = '';
      return;
    }

    // If user explicitly asks to generate the form, enable submit
    if (lower.includes('generate form')) {
      const prev = this.agui.state$.value || {};
      this.agui.state$.next({ ...prev, allow_submit: true });
    }

    // Friendly gating if the user simply greets without asking for anything specific
    if (this.isGreetingOnly(lower)) {
      const msgs = this.agui.messages$.value.slice();
      msgs.push({ role: 'user', text: t });
      msgs.push({ role: 'assistant', text: "Hi, I'm HelpDesk Assistant. I can help you create and submit IT helpdesk related requests. Here are some requests I can create right away, or you can instruct me to create a dynamic form for you. Say 'yes' or 'no' to continue." });
      this.agui.messages$.next(msgs);
      this.awaitingYesNo = true;
      this.input = '';
      return;
    }

    // Out-of-scope: apologize and ask yes/no to continue
    const msgs = this.agui.messages$.value.slice();
    msgs.push({ role: 'user', text: t });
    msgs.push({ role: 'assistant', text: "Hi, I'm HelpDesk Assistant. Sorry, I can help you create and submit IT helpdesk related requests. Here are some requests I can create right away, or you can instruct me to create a dynamic form for you. Say 'yes' or 'no' to continue." });
    this.agui.messages$.next(msgs);
    this.awaitingYesNo = true;
    this.optionsAllowed = false;
    this.input = '';
    return;

    this.agui.send(t);
    this.input = '';
  }

  choose(key: string) {
    this.agui.send(key);
  }

  get showWelcome(): boolean {
    // Show welcome chooser if no schema chosen yet
    return !this.state?.schema && this.optionsAllowed && !this.awaitingYesNo && !this.awaitingFieldSpec && !this.userDeclined;
  }

  // customization and clear fields actions removed per request

  private isIntroText(text: string): boolean {
    const t = (text || '').toLowerCase();
    return t.includes("helpdesk assistant") ||
           t.includes("tell me which one you want") ||
           t.includes("service authorization request") ||
           t.includes("exit request") ||
           t.includes("reimbursement") ||
           t.includes("bonafide certificate");
  }

  private isAffirmative(text: string): boolean {
    const s = (text || '').trim().toLowerCase();
    return s === 'yes' || s === 'y' || s.startsWith('yes ') || s.includes(' yes') || s === 'sure' || s.startsWith('sure');
  }

  private isNegative(text: string): boolean {
    const s = (text || '').trim().toLowerCase();
    return s === 'no' || s === 'n' || s.startsWith('no ') || s.includes(' no') || s.includes("don't") || s.includes('do not');
  }

  private parseRequestKey(lower: string): string | null {
    const mapping: { key: string; hints: string[] }[] = [
      { key: 'service_auth', hints: ['service authorization', 'service_auth'] },
      { key: 'exit_request', hints: ['exit request', 'exit_request'] },
      { key: 'reimbursement', hints: ['reimbursement'] },
      { key: 'bonafide_certificate', hints: ['bonafide certificate', 'bonafide_certificate'] }
    ];
    for (const m of mapping) {
      if (m.hints.some(h => lower.includes(h))) return m.key;
    }
    return null;
  }

  private isDynamicFormIntent(lower: string): boolean {
    if (lower.includes('dynamic form') || lower.includes('new type of form') || lower.includes('new form')) return true;
    if (/(create|build|make|need|want|design|generate)\s+.*\sform/.test(lower)) return true;
    if (/(^|\s)form for\s+.+/.test(lower)) return true;
    if (/\b\w+\s+form\b/.test(lower)) return true; // e.g., "policy form"
    return false;
  }

  private isGreetingOnly(lower: string): boolean {
    const greetTokens = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
    const isGreet = greetTokens.some(k => lower === k || lower.startsWith(k + ' ') || lower.endsWith(' ' + k) || lower.includes(' ' + k + ' '));
    if (!isGreet) return false;
    // Not asking for a known request or dynamic form
    if (this.parseRequestKey(lower)) return false;
    if (this.isDynamicFormIntent(lower)) return false;
    // No action verbs indicating intent
    const intentHints = ['create', 'build', 'make', 'need', 'want', 'request', 'form'];
    if (intentHints.some(h => lower.includes(h))) return false;
    return true;
  }
}

