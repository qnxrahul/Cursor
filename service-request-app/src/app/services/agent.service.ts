import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

export interface StartChatResponse {
  thread_id: string;
  message: string;
  field_key: string;
}

export interface RespondRequest {
  thread_id: string;
  message: string;
}

export interface RespondResponse {
  thread_id: string;
  message: string;
  done: boolean;
  field_key?: string | null;
  form_partial?: Record<string, string> | null;
  form?: Record<string, string> | null;
}

@Injectable({ providedIn: 'root' })
export class AgentService {
  private baseUrl = 'http://localhost:8000';
  // Shared state: thread id and latest partial form
  readonly threadId$ = new BehaviorSubject<string | null>(null);
  readonly formPartial$ = new BehaviorSubject<Record<string, string>>({});
  readonly done$ = new BehaviorSubject<boolean>(false);

  constructor(private http: HttpClient) {}

  start(): Observable<StartChatResponse> {
    return this.http.post<StartChatResponse>(`${this.baseUrl}/api/chat/start`, {}).pipe(
      tap((r) => {
        this.threadId$.next(r.thread_id);
        this.done$.next(false);
        this.formPartial$.next({});
      })
    );
  }

  respond(req: RespondRequest): Observable<RespondResponse> {
    return this.http.post<RespondResponse>(`${this.baseUrl}/api/chat/respond`, req).pipe(
      tap((r) => {
        if (r.form_partial) {
          this.formPartial$.next({ ...this.formPartial$.value, ...r.form_partial });
        }
        if (r.done) this.done$.next(true);
      })
    );
  }
}

