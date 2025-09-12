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
      // Try to parse locally and generate schema
      const parsed = this.parseFormSpec(t);
      if (parsed) {
        const { schema, submitLabel, formType } = parsed as any;
        const prev = this.agui.state$.value || {};
        const next: any = { ...prev, schema, allow_submit: true };
        if (formType) next.form_type = formType;
        if (submitLabel) next.schema = { ...schema, submitLabel };
        this.agui.state$.next(next);
        const msgs = this.agui.messages$.value.slice();
        msgs.push({ role: 'user', text: t });
        msgs.push({ role: 'assistant', text: `Generated ${formType ? (formType.charAt(0).toUpperCase()+formType.slice(1)) : 'form'} with ${schema.fields.length} field(s).` });
        this.agui.messages$.next(msgs);
        this.awaitingFieldSpec = false;
        this.optionsAllowed = false;
        this.input = '';
        return;
      } else {
        // Fallback to backend if parsing fails
        const prompt = `Create a dynamic form with these fields: ${t}`;
        this.agui.send(prompt);
        this.awaitingFieldSpec = false;
        const prev = this.agui.state$.value || {};
        this.agui.state$.next({ ...prev, allow_submit: true });
        this.input = '';
        return;
      }
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

  // -------- NL field spec parsing helpers --------
  private parseFormSpec(input: string): { schema: any; submitLabel?: string; formType?: string } | null {
    try {
      const text = (input || '').trim();
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

      // Split into clauses by punctuation
      const clauses = text
        .split(/(?<=[\.\!\?])\s+|\s*,\s*(?=[A-Za-z_\-]+\s*:\s*[A-Za-z])/)
        .map(s => s.trim())
        .filter(Boolean);

      const fields: any[] = [];

      for (const clause of clauses) {
        const c = clause.trim();
        if (!c) continue;

        // CSV style: label:type or label:type[opt1,opt2]
        const csvMatch = c.match(/^([A-Za-z][A-Za-z\s_\-]+)\s*:\s*([A-Za-z]+)(\[[^\]]+\])?$/);
        if (csvMatch) {
          const label = this.normalizeLabel(csvMatch[1]);
          const type = csvMatch[2].toLowerCase();
          const options = csvMatch[3] ? csvMatch[3].slice(1, -1).split(/\s*,\s*/).filter(Boolean) : undefined;
          fields.push(this.buildField(label, type, { options }));
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

        // Pattern: "<label> as a <type> with <options>"
        const asType = c.match(/^([A-Za-z][A-Za-z\s_\-]+)\s+as\s+a\s+([A-Za-z\s]+)(?:\s+with\s+(.+))?$/i);
        if (asType) {
          const label = this.normalizeLabel(asType[1]);
          const typeRaw = asType[2].toLowerCase();
          const type = this.normalizeType(typeRaw);
          const options = asType[3] ? this.parseOptions(asType[3]) : undefined;
          const required = /required/i.test(c);
          fields.push(this.buildField(label, type, { options, required }));
          continue;
        }

        // Pattern: dropdown/select having/with options
        const dd = c.match(/^(dropdown|select)\s+(?:having|with)\s+(.+)$/i);
        if (dd) {
          const label = this.normalizeLabel('Select');
          const options = this.parseOptions(dd[2]);
          fields.push(this.buildField(label, 'select', { options }));
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
    if (t.includes('select') || t.includes('dropdown')) return 'select';
    if (t.includes('radio')) return 'radio';
    if (t.includes('checkbox')) return 'checkbox';
    return 'text';
  }

  private parseOptions(s: string): string[] {
    const inside = s.match(/\[([^\]]+)\]/);
    const raw = inside ? inside[1] : s;
    return raw.split(/\s*[,\/]\s*/).map(x => x.trim()).filter(Boolean).map(x => this.normalizeLabel(x));
  }

  private guessTypeFromLabel(s: string): string {
    const l = s.toLowerCase();
    if (l.includes('email')) return 'email';
    if (l.includes('date')) return 'date';
    if (l.includes('number')) return 'number';
    if (l.includes('textarea') || l.includes('text area')) return 'textarea';
    if (l.includes('select') || l.includes('dropdown')) return 'select';
    if (l.includes('radio')) return 'radio';
    if (l.includes('checkbox')) return 'checkbox';
    if (l.includes('text field')) return 'text';
    return 'text';
  }

  private buildField(label: string, type: string, opts?: { required?: boolean; options?: string[] }): any {
    const key = this.keyFromLabel(label);
    const field: any = { key, label, type: type.toLowerCase() };
    if (typeof opts?.required === 'boolean') field.required = opts.required;
    if (Array.isArray(opts?.options) && (type === 'select' || type === 'radio' || type === 'checkbox')) field.options = opts.options;
    return field;
  }
}

