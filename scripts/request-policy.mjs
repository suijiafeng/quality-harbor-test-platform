import { assertWriteTarget } from './safety.mjs';

// A narrow network policy, not a guarantee that arbitrary GET endpoints lack side effects.
export function isRequestAllowed(rawURL, method, baseURL, { authenticated = false, writes = false } = {}) {
  const target = new URL(rawURL, baseURL);
  if (target.origin !== new URL(baseURL).origin) return false;
  method = method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (authenticated && method === 'POST' && target.pathname === '/api/auth/login' && !target.search) return true;
  if (!writes) return false;
  assertWriteTarget(baseURL, true);
  return true;
}

// Playwright follows API redirects by default, including redirects of POST bodies.
// Force zero redirects at every call, even if a caller supplies a different value.
export function guardAPI(context, baseURL, policy = {}) {
  const methods = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'fetch']);
  return new Proxy(context, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (methods.has(property)) return (url, options = {}) => {
        const requestURL = typeof url === 'string' ? url : url.url();
        const method = property === 'fetch' ? (options.method ?? (typeof url === 'string' ? 'GET' : url.method())) : property;
        if (!isRequestAllowed(requestURL, method, baseURL, policy)) throw new Error(`Blocked ${method.toUpperCase()} request outside the test network policy.`);
        try {
          return Promise.resolve(value.call(target, url, { ...options, maxRedirects: 0 })).catch(() => {
            throw new Error('API transport failed (request details omitted to protect credentials).');
          });
        } catch {
          throw new Error('API transport failed (request details omitted to protect credentials).');
        }
      };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
