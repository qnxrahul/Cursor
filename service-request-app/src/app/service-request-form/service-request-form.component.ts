import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AguiService } from '../services/agui.service';

@Component({
  selector: 'app-service-request-form',
  templateUrl: './service-request-form.component.html'
})
export class ServiceRequestFormComponent implements OnDestroy {
  form: FormGroup;
  done = false;
  private subs: Subscription[] = [];

  constructor(private fb: FormBuilder, private agui: AguiService) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      issue_details: ['', Validators.required],
      type: ['', Validators.required],
      urgency: ['', Validators.required],
      location: ['', Validators.required]
    });

    // Bind to agent state for incremental form patching
    const s = this.agui.state$.subscribe((st: any) => {
      if (st && st['form']) {
        const entries = Object.entries(st['form'] as Record<string, any>);
        for (const [k, v] of entries) {
          if (this.form.controls[k]) this.form.controls[k].setValue(v);
        }
      }
      if (typeof st?.['next_field_index'] === 'number') {
        this.done = st['next_field_index'] >= 6;
      }
    });
    this.subs.push(s);

    // Ensure session started so first question is asked
    this.agui.start();
  }

  ngOnDestroy(): void {
    this.subs.forEach((x) => x.unsubscribe());
  }
}

