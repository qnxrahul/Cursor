import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AgentService, RespondResponse, StartChatResponse } from '../services/agent.service';

@Component({
  selector: 'app-service-request-form',
  templateUrl: './service-request-form.component.html'
})
export class ServiceRequestFormComponent {
  form: FormGroup;
  threadId: string | null = null;
  done = false;

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
    this.agent.start().subscribe((res: StartChatResponse) => {
      this.threadId = res.thread_id;
    });
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
}

