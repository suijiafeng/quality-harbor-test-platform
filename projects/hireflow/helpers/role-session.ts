import { type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { assertWriteTarget } from '../../../src/core/target.mjs';
import { guardAPI } from '../../../src/core/request-policy.mjs';
import { roleCredentials, redactRoleValue } from './role-credentials.mjs';
export { staffRoles, roleCredentials, hasRoleCredentials } from './role-credentials.mjs';

type Session = { accessToken: string; user: any };

// Only disposable workflow suites use this helper. All traffic shares the normal
// same-origin, loopback-write and no-redirect policy, including anonymous portals.
export class RoleSession {
  readonly sessions: Record<string, Session> = {};
  private contexts = new Map<string, APIRequestContext>();
  private secrets = new Set<string>();
  private baseURL: string;

  private playwright: Pick<PlaywrightWorkerArgs['playwright'], 'request'>;

  constructor(playwright: Pick<PlaywrightWorkerArgs['playwright'], 'request'>, baseURL: string) {
    this.playwright = playwright;
    this.baseURL = assertWriteTarget(baseURL,
      process.env.HF_ALLOW_WRITES === '1' && process.env.HF_TEST_ENV === 'disposable');
  }

  private learn(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/token|password|authorization|secret/i.test(key) && typeof item === 'string') this.secrets.add(item);
      else this.learn(item);
    }
  }

  redact(value: any): any { return redactRoleValue(value, this.secrets); }

  private async context(actor: string | null): Promise<APIRequestContext> {
    const anonymous = actor === null || ['anonymous', 'candidate', 'newHire'].includes(actor);
    const key = anonymous ? 'anonymous' : actor;
    if (!anonymous && !this.sessions[key]) throw new Error('Staff actor must authenticate before requesting business endpoints.');
    let context = this.contexts.get(key);
    if (!context) {
      context = await this.playwright.request.newContext({
        baseURL: this.baseURL,
        extraHTTPHeaders: anonymous ? {} : { Authorization: `Bearer ${this.sessions[key].accessToken}` },
        timeout: 30_000,
      });
      this.contexts.set(key, context);
    }
    return guardAPI(context, this.baseURL, { authenticated: true, writes: true });
  }

  async request(actor: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Use an API-relative path.');
    const url = new URL(`/api${path}`, this.baseURL);
    if (!url.pathname.startsWith('/api/')) throw new Error('API path must remain under /api/.');
    this.learn(body);
    const api = await this.context(actor);
    const response = await api.fetch(url.href, { method, ...(body === undefined ? {} : { data: body }) });
    try {
      const data = await response.json().catch(() => null);
      this.learn(data);
      return { status: response.status(), data };
    } finally { await response.dispose(); }
  }

  async call(actor: string | null, method: string, path: string, body?: unknown, expected = method.toUpperCase() === 'POST' ? 201 : 200): Promise<any> {
    const { status, data } = await this.request(actor, method, path, body);
    if (status !== expected) throw new Error(`${method.toUpperCase()} ${this.redact(path)} expected ${expected}, got ${status}.`);
    return data;
  }

  async login(actor: string, email?: string, password?: string): Promise<any> {
    const credentials = email === undefined && password === undefined ? roleCredentials(actor) : { email, password };
    if (!credentials.email || !credentials.password) throw new Error('Provide both private email and password for the required test actor.');
    this.secrets.add(credentials.password);
    const auth = await this.call(null, 'POST', '/auth/login', credentials, 200);
    if (typeof auth?.accessToken !== 'string' || !auth.user?.id) throw new Error('Authentication returned an invalid session.');
    const previous = this.contexts.get(actor);
    if (previous) { await previous.dispose(); this.contexts.delete(actor); }
    this.sessions[actor] = auth;
    return auth.user;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.contexts.values()].map(context => context.dispose()));
    this.contexts.clear();
    for (const actor of Object.keys(this.sessions)) delete this.sessions[actor];
    this.secrets.clear();
  }
}
