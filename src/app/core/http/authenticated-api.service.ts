import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { AuthSessionService } from '../auth/auth-session.service';

export type ApiQuery = Readonly<Record<string, string | number | boolean | undefined>>;

@Injectable({ providedIn: 'root' })
export class AuthenticatedApiService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthSessionService,
  ) {}

  get<T>(url: string, query: ApiQuery = {}): Observable<T> {
    return this.http.get<T>(url, {
      headers: this.headers(),
      params: this.params(query),
    });
  }

  post<T>(url: string, body: unknown, idempotencyKey?: string): Observable<T> {
    return this.http.post<T>(url, body, { headers: this.headers(idempotencyKey) });
  }

  put<T>(url: string, body: unknown, idempotencyKey?: string): Observable<T> {
    return this.http.put<T>(url, body, { headers: this.headers(idempotencyKey) });
  }

  headers(idempotencyKey?: string): HttpHeaders {
    const token = this.auth.token;
    if (!token) throw new Error('authenticated-api-session-required');
    return new HttpHeaders({
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    });
  }

  private params(query: ApiQuery): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params = params.set(key, String(value));
    }
    return params;
  }
}
