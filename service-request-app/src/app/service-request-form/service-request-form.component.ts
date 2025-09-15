import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AguiService } from '../services/agui.service';
import * as AdaptiveCards from 'adaptivecards';

@Component({
  selector: 'app-service-request-form',
  templateUrl: './service-request-form.component.html'
})
export class ServiceRequestFormComponent implements OnDestroy {
  form: FormGroup;
  done = false;
  schema: any = null;
  allowSubmit = false;
  schemaConfirmed = false;
  showEditor = false;
  pendingRemovals = new Set<string>();
  private subs: Subscription[] = [];
  private cardHostId = 'ac-form-host';
  private lastRenderedCard = '';

  constructor(private fb: FormBuilder, private agui: AguiService) {
    this.form = this.fb.group({});

    // Bind to agent state for incremental form patching
    const s = this.agui.state$.subscribe((st: any) => {
      if (st && st['schema']) {
        // Build dynamic controls if schema changed
        const sameSchema = JSON.stringify(this.schema) === JSON.stringify(st['schema']);
        this.schema = st['schema'];
        if (!sameSchema) {
          const group: Record<string, FormControl> = {} as any;
          const fields = (this.schema?.fields || []) as any[];
          for (const f of fields) {
            const key = f.key;
            const req = f.required === true;
            const type = (f.type || 'text').toLowerCase();
            const validators = [] as any[];
            if (req) validators.push(Validators.required);
            if (type === 'email') validators.push(Validators.email);
            const initial = type === 'checkbox' ? [] : '';
            group[key] = new FormControl(initial, validators);
          }
          this.form = this.fb.group(group);
          // Signal chat to ask for confirmation in the chat UI on first schema render
          const prev = this.agui.state$.value || {};
          this.agui.state$.next({ ...prev, schema_confirmed: !!prev['schema_confirmed'] });
        }
      }
      // Render any Adaptive Card on the form side as well
      const serverCard = (st && (st as any).card) as any;
      if (serverCard) {
        setTimeout(() => this.renderAdaptiveCard(serverCard));
      }
      if (st && st['form']) {
        const entries = Object.entries(st['form'] as Record<string, any>);
        for (const [k, v] of entries) {
          if (this.form.controls[k]) this.form.controls[k].setValue(v);
        }
      }
      if (typeof st?.['next_field_index'] === 'number') {
        const total = Array.isArray(this.schema?.fields) ? this.schema.fields.length : 6;
        this.done = st['next_field_index'] >= total;
      }
      // Allow submit only when backend signals schema is confirmed or done
      if (typeof st?.['schema_confirmed'] === 'boolean') {
        this.schemaConfirmed = !!st['schema_confirmed'];
        this.allowSubmit = this.schemaConfirmed;
      } else if (this.done) {
        this.allowSubmit = true;
      }
      if (typeof st?.['allow_submit'] === 'boolean') {
        this.allowSubmit = this.allowSubmit || !!st['allow_submit'];
      }
      // Render Adaptive Card form when no server-provided card
      const serverCard2 = (st && (st as any).card) as any;
      if (serverCard2) {
        setTimeout(() => this.renderAdaptiveCard(serverCard2));
      } else if (this.schema) {
        const ac = this.buildFormAdaptiveCard(this.schema, (st && (st as any).form) || {});
        const sig = JSON.stringify(ac);
        if (sig !== this.lastRenderedCard) {
          this.lastRenderedCard = sig;
          setTimeout(() => this.renderAdaptiveCard(ac));
        }
      }
    });
    this.subs.push(s);

    // Do not start the session here; chat component is responsible for starting once
  }

  onUserReply(input: string): void {
    const text = (input || '').trim();
    if (!text) return;
    this.agui.send(text);
  }

  isChecked(fieldKey: string, option: any): boolean {
    const val = this.form.get(fieldKey)?.value;
    return Array.isArray(val) ? val.indexOf(option) !== -1 : false;
  }

  toggleCheckbox(fieldKey: string, option: any, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const ctrl = this.form.get(fieldKey);
    if (!ctrl) return;
    const curr = Array.isArray(ctrl.value) ? [...ctrl.value] : [];
    if (input.checked) {
      if (curr.indexOf(option) === -1) curr.push(option);
    } else {
      const idx = curr.indexOf(option);
      if (idx !== -1) curr.splice(idx, 1);
    }
    ctrl.setValue(curr);
    ctrl.markAsDirty();
  }

  submit(): void {
    if (this.form.valid) {
      console.log('Submit payload', this.form.value);
    }
  }

  openEditor(): void { this.showEditor = true; }
  closeEditor(): void { this.showEditor = false; }

  onApplyEdits(evt: { removeKeys: string[]; addFields: Array<{ label: string; type: string; required?: boolean; options?: string[] }> }): void {
    // Send remove commands first
    for (const k of evt.removeKeys || []) {
      this.agui.send(`remove field ${k}`);
    }
    // Then add new fields (support options via (a,b,c))
    for (const nf of evt.addFields || []) {
      const key = this.keyFromLabel(nf.label);
      const type = (nf.type || 'text').toLowerCase();
      const req = nf.required ? ':required' : '';
      const opts = (Array.isArray(nf.options) && nf.options.length > 0 && (type === 'select' || type === 'radio' || type === 'checkbox'))
        ? `(${nf.options.join(', ')})` : '';
      this.agui.send(`add field ${key}:${type}${req}${opts}`);
    }
    this.showEditor = false;
  }

  private keyFromLabel(label: string): string {
    return (label || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_');
  }

  private renderAdaptiveCard(cardPayload: any) {
    try {
      const host = document.getElementById(this.cardHostId);
      if (!host) return;
      host.innerHTML = '';
      const card = new AdaptiveCards.AdaptiveCard();
      // Beautiful, interactive host configuration inspired by AG-UI examples
      card.hostConfig = new AdaptiveCards.HostConfig({
        supportsInteractivity: true,
        spacing: { small: 6, default: 10, medium: 16, large: 20, extraLarge: 28, padding: 14 },
        separator: { lineThickness: 1, lineColor: "#E5E7EB" },
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        fontSizes: { small: 12, default: 14, medium: 16, large: 18, extraLarge: 22 },
        containerStyles: {
          default: { backgroundColor: "#FFFFFF", foregroundColors: { default: { default: "#111827", subtle: "#6B7280" }, accent: { default: "#2563EB", subtle: "#60A5FA" } } },
          emphasis: { backgroundColor: "#F9FAFB", foregroundColors: { default: { default: "#111827", subtle: "#6B7280" }, accent: { default: "#2563EB", subtle: "#60A5FA" } } }
        },
        actions: {
          actionsOrientation: 'horizontal',
          actionAlignment: 'stretch',
          maxActions: 5,
          buttonSpacing: 10,
          showCard: { actionMode: 'inline', inlineTopMargin: 10 },
          buttonSpacingDefinition: { spacing: 10 },
          iconPlacement: 'leftOfTitle'
        },
        inputs: { errorMessage: { color: "#DC2626" } }
      });
      card.onExecuteAction = (action: any) => {
        const data = (action && (action.data || {})) || {};
        if (data && typeof data === 'object') {
          // For form submit, also capture all inputs
          if (data && data.action === 'form_fill_submit') {
            const inputs = (action as any).getInputs?.() || [];
            const payload: any = {};
            for (const inp of inputs) {
              const id = (inp && inp.id) || (inp && inp._id);
              if (!id) continue;
              payload[id] = (inp.value != null ? inp.value : '');
            }
            this.agui.send(JSON.stringify({ ac: { action: 'form_fill_submit', values: payload } }));
          } else {
            this.agui.send(JSON.stringify({ ac: data }));
          }
        }
      };
      card.parse(cardPayload);
      const rendered = card.render();
      if (rendered) host.appendChild(rendered);
    } catch {}
  }

  private buildFormAdaptiveCard(schema: any, form: Record<string, any>): any {
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];
    const body: any[] = [
      { type: 'TextBlock', text: (schema?.title || 'Form'), weight: 'Bolder', size: 'Medium' }
    ];
    for (const f of fields) {
      const key = f.key;
      const label = f.label || key;
      const type = (f.type || 'text').toLowerCase();
      const required = !!f.required;
      const val = form[key] ?? '';
      body.push({ type: 'TextBlock', text: label + (required ? ' *' : ''), wrap: true });
      if (type === 'textarea') {
        body.push({ type: 'Input.Text', id: key, isMultiline: true, value: String(val || '') });
      } else if (type === 'select') {
        const choices = (f.options || []).map((o: string) => ({ title: o, value: o }));
        body.push({ type: 'Input.ChoiceSet', id: key, style: 'compact', value: String(val || ''), choices });
      } else if (type === 'radio') {
        const choices = (f.options || []).map((o: string) => ({ title: o, value: o }));
        body.push({ type: 'Input.ChoiceSet', id: key, style: 'expanded', isMultiSelect: false, value: String(val || ''), choices });
      } else if (type === 'checkbox') {
        const arr = Array.isArray(val) ? val : [];
        const choices = (f.options || []).map((o: string) => ({ title: o, value: o }));
        body.push({ type: 'Input.ChoiceSet', id: key, isMultiSelect: true, value: arr.join(','), choices });
      } else if (type === 'date') {
        body.push({ type: 'Input.Date', id: key, value: String(val || '') });
      } else if (type === 'number') {
        body.push({ type: 'Input.Number', id: key, value: val === '' ? undefined : Number(val) });
      } else if (type === 'email' || type === 'text' || type === 'password' || type === 'tel' || type === 'url') {
        body.push({ type: 'Input.Text', id: key, value: String(val || '') });
      } else {
        body.push({ type: 'Input.Text', id: key, value: String(val || '') });
      }
    }
    const actions = [
      { type: 'Action.Submit', title: `🚀 ${schema?.submitLabel || 'Submit'}`, data: { action: 'form_fill_submit' } }
    ];
    return { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.5', body, actions };
  }

  ngOnDestroy(): void {
    this.subs.forEach((x) => x.unsubscribe());
  }
}

