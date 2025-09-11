import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AguiService } from '../services/agui.service';

@Component({
  selector: 'app-service-request-form',
  templateUrl: './service-request-form.component.html'
})
export class ServiceRequestFormComponent implements OnDestroy {
  form: FormGroup;
  done = false;
  schema: any = null;
  private subs: Subscription[] = [];

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
            group[key] = new FormControl('', validators);
          }
          this.form = this.fb.group(group);
        }
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
    });
    this.subs.push(s);

    // Do not start the session here; chat component is responsible for starting once
  }

  onUserReply(input: string): void {
    const text = (input || '').trim();
    if (!text) return;
    this.agui.send(text);
  }

  submit(): void {
    if (this.form.valid) {
      console.log('Submit payload', this.form.value);
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((x) => x.unsubscribe());
  }
}

