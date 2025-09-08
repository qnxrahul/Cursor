import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AgentService, RespondResponse, StartChatResponse } from '../services/agent.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-service-request-form',
  templateUrl: './service-request-form.component.html'
})
export class ServiceRequestFormComponent implements OnDestroy {
  form: FormGroup;
  threadId: string | null = null;
  done = false;
  private subs: Subscription[] = [];

  constructor(private fb: FormBuilder, private agent: AgentService) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      issue_details: ['', Validators.required],
      type: ['', Validators.required],
      urgency: ['', Validators.required],
      location: ['', Validators.required]
    });

    // Start chat to get first prompt
    const s1 = this.agent.threadId$.subscribe((tid) => (this.threadId = tid));
    const s2 = this.agent.formPartial$.subscribe((partial) => {
      Object.entries(partial).forEach(([k, v]) => {
        if (this.form.controls[k]) this.form.controls[k].setValue(v);
      });
    });
    const s3 = this.agent.done$.subscribe((d) => (this.done = d));
    this.subs.push(s1, s2, s3);
    // Ensure a session exists
    this.agent.start().subscribe();
  }

  onUserReply(input: string): void {
    const text = input.trim();
    if (!text || !this.threadId) return;
    this.agent.respond({ thread_id: this.threadId, message: text }).subscribe((res: RespondResponse) => {
      if (res.form_partial) {
        Object.entries(res.form_partial).forEach(([k, v]) => {
          if (this.form.controls[k]) this.form.controls[k].setValue(v);
        });
      }
      if (res.done && res.form) {
        Object.entries(res.form).forEach(([k, v]) => {
          if (this.form.controls[k]) this.form.controls[k].setValue(v);
        });
        this.done = true;
      }
    });
  }

  submit(): void {
    if (this.form.valid) {
      console.log('Submit payload', this.form.value);
      // TODO: send to a submit endpoint if needed
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
}

