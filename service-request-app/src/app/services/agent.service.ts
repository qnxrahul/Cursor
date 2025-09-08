import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

  constructor(private http: HttpClient) {}

  start(): Observable<StartChatResponse> {
    return this.http.post<StartChatResponse>(`${this.baseUrl}/api/chat/start`, {});
  }

  respond(req: RespondRequest): Observable<RespondResponse> {
    return this.http.post<RespondResponse>(`${this.baseUrl}/api/chat/respond`, req);
  }
}

