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
  matchedRequests: { key: string; label: string }[] = [];
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
      this.agui.messages$.next([{
        role: 'assistant',
        text: "Hi, I'm HelpDesk Assistant. I can help you create and submit IT helpdesk related requests. Here are some requests I can create right away, or you can instruct me to create a dynamic form for you."
      }]);
      this.optionsAllowed = true;
      this.matchedRequests = [...this.requests];
    }
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  send() {
    const t = this.input.trim();
    if (!t) return;
    this.hasUserResponded = true;
    const lower = t.toLowerCase();

    // We avoid rigid yes/no gating; make it more conversational.

    // If we previously asked for field specs, ALWAYS forward to AI agent
    if (this.awaitingFieldSpec) {
      // Finish collecting fields
      if (this.isDoneAdding(lower)) {
        this.agui.send('done');
        this.awaitingFieldSpec = false;
        this.input = '';
        return;
      }
      // Handle explicit yes/no confirmations from agent prompt
      if (this.isAffirmative(t)) {
        this.agui.send('yes');
        this.awaitingFieldSpec = false;
        const prev = this.agui.state$.value || {};
        this.agui.state$.next({ ...prev, allow_submit: true });
        this.input = '';
        return;
      }
      if (this.isNegative(t)) {
        // Tell agent user wants to change; keep waiting
        this.agui.send('no');
        this.input = '';
        return;
      }
      // Send user's text verbatim to avoid confusing the model with local parsing hints
      this.agui.send(t);
      // Keep awaiting spec so user can add more
      const prev = this.agui.state$.value || {};
      this.agui.state$.next({ ...prev, allow_submit: true });
      this.input = '';
      return;
    }

    // Natural matching: if user seems to reference built-in requests, show matching options
    const matches = this.findMatchingRequests(lower);
    if (matches.length > 0) {
      const msgs = this.agui.messages$.value.slice();
      msgs.push({ role: 'user', text: t });
      const names = matches.map(m => m.label).join(', ');
      msgs.push({ role: 'assistant', text: `Got it. Based on what you said, these look relevant: ${names}. Please choose one below.` });
      this.agui.messages$.next(msgs);
      this.matchedRequests = matches;
      this.optionsAllowed = true;
      this.userDeclined = false;
      this.awaitingYesNo = false;
      this.input = '';
      return;
    }

    // Otherwise, steer toward custom dynamic form via natural language
    {
      // Send user's message to the agent verbatim
      this.agui.send(t);
      // Show a single guidance message and wait for user fields
      const msgs = this.agui.messages$.value.slice();
      msgs.push({ role: 'assistant', text: 'No built-in request matched. You can paste your form fields or describe them naturally (e.g., name:text (required), email:email (required), status:select (Pending, Approved)).' });
      this.agui.messages$.next(msgs);
      this.startFieldSpecPrompt();
      this.input = '';
      return;
    }

    // If input matches a known request, route to backend immediately
    const reqKeyEarly = this.parseRequestKey(lower);
    if (reqKeyEarly) {
      this.agui.send(reqKeyEarly!);
      this.optionsAllowed = false;
      this.input = '';
      return;
    }

    // Detect intent to create a new custom form (e.g., "I need policy form")
    const asksNewForm = this.isDynamicFormIntent(lower);
    if (asksNewForm) {
      // Notify AI agent of intent and ask for specs to ensure consistent context
      this.agui.send(`User wants to create a new dynamic form: ${t}. Ask for fields and CSS preferences.`);
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
      // Just surface options again
      const msgs = this.agui.messages$.value.slice();
      msgs.push({ role: 'user', text: t });
      msgs.push({ role: 'assistant', text: 'Please choose a request below or describe the fields for a new form.' });
      this.agui.messages$.next(msgs);
      this.matchedRequests = [...this.requests];
      this.optionsAllowed = true;
      this.awaitingYesNo = false;
      this.input = '';
      return;
    }

    // Out-of-scope: apologize and ask yes/no to continue
    const msgs = this.agui.messages$.value.slice();
    msgs.push({ role: 'user', text: t });
    msgs.push({ role: 'assistant', text: 'I can help with IT helpdesk requests. Please choose one below or describe the fields for a new form.' });
    this.agui.messages$.next(msgs);
    this.matchedRequests = [...this.requests];
    this.optionsAllowed = true;
    this.awaitingYesNo = false;
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
    return /^\s*(yes|y|sure)\s*[\.!?]*\s*$/.test(s);
  }

  private isNegative(text: string): boolean {
    const s = (text || '').trim().toLowerCase();
    return /^\s*(no|n)\s*[\.!?]*\s*$/.test(s);
  }
  private isSpecOrChange(lower: string): boolean {
    // Heuristics to decide if user typed fields/options/theme changes
    return (
      /:\s*(text|email|number|date|radio|select|textarea)/.test(lower) ||
      /(required|optional)/.test(lower) ||
      /(with|having)\s+[a-z0-9 ,\/\-\[\]]+/.test(lower) ||
      /theme\s*\{/.test(lower) ||
      /add\s+field|remove\s+field|change\s+label/.test(lower)
    );
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

  private findMatchingRequests(lower: string): { key: string; label: string }[] {
    const mapping: { key: string; hints: string[] }[] = [
      { key: 'service_auth', hints: ['service authorization', 'service auth', 'authorization', 'authorize service', 'service_auth'] },
      { key: 'exit_request', hints: ['exit request', 'resignation', 'relieving letter', 'exit_request'] },
      { key: 'reimbursement', hints: ['reimbursement', 'expense claim', 'claim back'] },
      { key: 'bonafide_certificate', hints: ['bonafide certificate', 'bonafide', 'college certificate', 'bonafide_certificate'] }
    ];
    const keys = new Set<string>();
    for (const m of mapping) {
      if (m.hints.some(h => lower.includes(h))) keys.add(m.key);
    }
    return (this.requests || []).filter(r => keys.has(r.key));
  }

  startFieldSpecPrompt(original?: string) {
    this.awaitingFieldSpec = true;
    this.optionsAllowed = false;
    this.userDeclined = false;
    const msgs = this.agui.messages$.value.slice();
    this.agui.messages$.next(msgs);
    // Intentionally do not send a meta command to the agent here; wait for user input.
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

  private isDoneAdding(lower: string): boolean {
    const tokens = ['done', "that's all", 'no more', 'finish', 'finished'];
    return tokens.some(t => lower === t || lower.startsWith(t + ' '));
  }

  // -------- NL field spec parsing helpers --------
  private parseFormSpec(input: string): { schema: any; submitLabel?: string; formType?: string } | null {
    try {
      let text = (input || '').trim();
      // Normalize curly quotes/dashes
      text = text.replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/[–—]/g, '-');
      if (!text) return null;
      const lower = text.toLowerCase();

      // Form type e.g., "policy form"
      let formType: string | undefined;
      const typeMatch = text.match(/([A-Za-z][A-Za-z\s]+?)\s+form/);
      if (typeMatch && typeMatch[1]) {
        formType = typeMatch[1].trim().toLowerCase();
      }

      // Submit label
      let submitLabel: string | undefined;
      const submitMatch = text.match(/submit\s+label\s+should\s+be\s+([A-Za-z][A-Za-z\s]+)/i);
      if (submitMatch && submitMatch[1]) submitLabel = submitMatch[1].trim();

      // Fallback: also detect quoted label
      const quotedLabel = text.match(/submit\s+label\s+should\s+be\s+"([^"]+)"|'([^']+)'/i);
      if (!submitLabel && quotedLabel) submitLabel = (quotedLabel[1] || quotedLabel[2] || '').trim();

      // Remove submit label phrase from text so it doesn't get parsed as a field
      text = text.replace(/submit\s+label\s+should\s+be[^\.\n]*[\.|\n]?/gi, ' ');
      // Remove leading "<type> form:" prefix if present
      text = text.replace(/^[\s\"']*[A-Za-z][A-Za-z\s]+?\s+form\s*:\s*/i, '');

      // Split into clauses by sentences, semicolons, and general commas
      const clauses = text
        .split(/(?<=[\.!\?])\s+|\s*;\s*|\s*,\s*/)
        .map(s => s.trim())
        .filter(Boolean);

      const fields: any[] = [];

      for (const clause of clauses) {
        let c = clause.trim();
        if (!c) continue;
        // Skip if this clause is about submit label
        if (/^submit\s+label\s+should\s+be/i.test(c)) continue;
        // Remove any surrounding quotes
        c = c.replace(/^\"|\"$/g, '').trim();
        // Remove redundant prefix like "Policy form:"
        c = c.replace(/^[A-Za-z][A-Za-z\s]+?\s+form\s*:\s*/i, '');

        // CSV style: label:type or label:type[opt1,opt2]
        const csvMatch = c.match(/^([A-Za-z][A-Za-z\s_\-]+)\s*:\s*([A-Za-z]+)(\[[^\]]+\])?$/);
        if (csvMatch) {
          const label = this.normalizeLabel(csvMatch[1]);
          const type = csvMatch[2].toLowerCase();
          const options = csvMatch[3] ? csvMatch[3].slice(1, -1).split(/\s*,\s*/).filter(Boolean) : undefined;
          fields.push(this.buildField(label, type, { options }));
          continue;
        }

        // Compound: "X and Y required"
        const bothReq = c.match(/^([A-Za-z][A-Za-z\s_\-]+)\s+and\s+([A-Za-z][A-Za-z\s_\-]+)\s+required/i);
        if (bothReq) {
          const a = this.normalizeLabel(bothReq[1]);
          const b = this.normalizeLabel(bothReq[2]);
          fields.push(this.buildField(a, this.guessTypeFromLabel(a), { required: true }));
          fields.push(this.buildField(b, this.guessTypeFromLabel(b), { required: true }));
          continue;
        }

        // Pattern: "<label> (required|optional)"
        const reqMatch = c.match(/^([A-Za-z][A-Za-z\s_\-]+)\s*\((required|optional)\)/i);
        if (reqMatch) {
          const label = this.normalizeLabel(reqMatch[1]);
          const required = reqMatch[2].toLowerCase() === 'required';
          // Guess type by keywords
          const guessedType = this.guessTypeFromLabel(c);
          fields.push(this.buildField(label, guessedType, { required }));
          continue;
        }

        // Pattern: "<label> as a/an <type> with <options>" or without options
        const asType = c.match(/^([A-Za-z][A-Za-z\s_\-]+)\s+as\s+(?:a\s+|an\s+)?([A-Za-z\s]+?)(?:\s+with\s+(.+))?$/i);
        if (asType) {
          const label = this.normalizeLabel(asType[1]);
          const typeRaw = asType[2].toLowerCase();
          const type = this.normalizeType(typeRaw);
          const options = asType[3] ? this.parseOptions(asType[3]) : undefined;
          const required = /required/i.test(c) && !/optional/i.test(c);
          fields.push(this.buildField(label, type, { options, required }));
          continue;
        }

        // Pattern: "<label> dropdown/select having/with <options>"
        const dd2 = c.match(/^([A-Za-z][A-Za-z\s_\-]+)\s+(dropdown|select)\s+(?:having|with)\s+(.+)$/i);
        if (dd2) {
          const label = this.normalizeLabel(dd2[1]);
          const options = this.parseOptions(dd2[3]);
          fields.push(this.buildField(label, 'select', { options }));
          continue;
        }
        // Pattern: dropdown/select having/with options (no explicit label)
        const dd = c.match(/^(dropdown|select)\s+(?:having|with)\s+(.+)$/i);
        if (dd) {
          const opts = this.parseOptions(dd[2]);
          const label = this.normalizeLabel((dd[2].match(/^[A-Za-z\s]+/) || ['Select'])[0]);
          fields.push(this.buildField(label, 'select', { options: opts }));
          continue;
        }

        // Pattern: radios yes/no
        if (/radio\s+yes\s*\/\s*no/i.test(c) || /radio\s+yes\s*\W\s*no/i.test(c)) {
          const label = this.normalizeLabel(c.replace(/radio.*/i, '').trim() || 'Choice');
          fields.push(this.buildField(label, 'radio', { options: ['Yes', 'No'] }));
          continue;
        }

        // Dates explicitly mentioned
        if (/date\s+required/i.test(c) || /\bdate\b/i.test(c)) {
          const label = this.normalizeLabel(c.replace(/\bdate\b.*/i, '').trim() || 'Date');
          const required = /required/i.test(c);
          fields.push(this.buildField(label, 'date', { required }));
          continue;
        }

        // Fallback guess from words like email, textarea, number, text field
        const guessedType = this.guessTypeFromLabel(c);
        if (guessedType) {
          const label = this.normalizeLabel(c.replace(/\(.*?\)/g, '').trim());
          const required = /required/i.test(c);
          const optional = /optional/i.test(c);
          fields.push(this.buildField(label, guessedType, { required: optional ? false : required }));
          continue;
        }
      }

      if (fields.length === 0) return null;

      const schema = { fields } as any;
      if (submitLabel) schema.submitLabel = submitLabel;
      return { schema, submitLabel, formType };
    } catch {
      return null;
    }
  }

  private normalizeLabel(raw: string): string {
    return (raw || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
  }

  private keyFromLabel(label: string): string {
    return (label || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_');
  }

  private normalizeType(typeRaw: string): string {
    const t = (typeRaw || '').toLowerCase().trim();
    if (t.includes('text area') || t.includes('textarea')) return 'textarea';
    if (t.includes('text field') || t === 'text') return 'text';
    if (t.includes('email')) return 'email';
    if (t.includes('number')) return 'number';
    if (t.includes('date')) return 'date';
    if (t.includes('datetime')) return 'datetime-local';
    if (t.includes('time')) return 'time';
    if (t.includes('select') || t.includes('dropdown')) return 'select';
    if (t.includes('radio')) return 'radio';
    if (t.includes('checkbox')) return 'checkbox';
    if (t.includes('password')) return 'password';
    if (t.includes('phone') || t.includes('tel')) return 'tel';
    if (t.includes('url') || t.includes('website') || t.includes('link')) return 'url';
    if (t.includes('color')) return 'color';
    if (t.includes('month')) return 'month';
    if (t.includes('week')) return 'week';
    if (t.includes('range') || t.includes('slider')) return 'range';
    return 'text';
  }

  private parseOptions(s: string): string[] {
    const inside = s.match(/\[([^\]]+)\]/);
    const raw = inside ? inside[1] : s;
    return raw
      .replace(/^(pending|approved|yes|no)\b/gi, (m) => m) // keep common tokens
      .split(/\s*[,\/]|\s+and\s+|\s+or\s+/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => this.normalizeLabel(x));
  }

  private guessTypeFromLabel(s: string): string {
    const l = s.toLowerCase();
    if (l.includes('email')) return 'email';
    if (l.includes('date')) return 'date';
    if (l.includes('datetime') || l.includes('date and time')) return 'datetime-local';
    if (l.includes('time')) return 'time';
    if (l.includes('number')) return 'number';
    if (l.includes('textarea') || l.includes('text area')) return 'textarea';
    if (l.includes('select') || l.includes('dropdown')) return 'select';
    if (l.includes('radio')) return 'radio';
    if (l.includes('checkbox')) return 'checkbox';
    if (l.includes('text field')) return 'text';
    if (l.includes('password')) return 'password';
    if (l.includes('phone') || l.includes('tel') || l.includes('mobile')) return 'tel';
    if (l.includes('url') || l.includes('website') || l.includes('link')) return 'url';
    if (l.includes('color')) return 'color';
    if (l.includes('month')) return 'month';
    if (l.includes('week')) return 'week';
    if (l.includes('range') || l.includes('slider')) return 'range';
    return 'text';
  }

  private buildField(label: string, type: string, opts?: { required?: boolean; options?: string[] }): any {
    const key = this.keyFromLabel(label);
    const field: any = { key, label, type: type.toLowerCase() };
    if (typeof opts?.required === 'boolean') field.required = opts.required;
    if (Array.isArray(opts?.options) && (type === 'select' || type === 'radio' || type === 'checkbox')) field.options = opts.options;
    return field;
  }

  private mergeFields(existing: any[], additions: any[]): any[] {
    const map = new Map<string, any>();
    for (const f of existing || []) {
      map.set(f.key, { ...f });
    }
    for (const nf of additions || []) {
      map.set(nf.key, { ...map.get(nf.key), ...nf });
    }
    return Array.from(map.values());
  }
}

