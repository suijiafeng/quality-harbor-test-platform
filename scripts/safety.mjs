export function validateBaseURL(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Provide an absolute http(s) application URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an http(s) URL without credentials, query parameters or fragments.');
  }
  if (url.pathname !== '/') throw new Error('Provide the application root URL, not a page or API path.');
  return url.origin;
}
export function assertWriteTarget(raw, acknowledged) {
  const baseURL = validateBaseURL(raw);
  const url = new URL(baseURL);
  if (!acknowledged || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Write tests require --allow-writes and a disposable loopback-hosted test instance. Remote writes are disabled.');
  }
  return baseURL;
}
