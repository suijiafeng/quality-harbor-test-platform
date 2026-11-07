import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseURL, assertWriteTarget } from '../../src/core/target.mjs';
test('normalizes local URL', () => assert.equal(validateBaseURL('http://localhost:5173/'), 'http://localhost:5173'));
test('accepts HTTPS remote URL for read-only checks', () => assert.equal(validateBaseURL('https://example.com'), 'https://example.com'));
for (const value of ['file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?token=x', 'https://example.com#fragment', 'not a URL']) {
  test(`rejects unsafe or ambiguous URL: ${value}`, () => assert.throws(() => validateBaseURL(value)));
}
for (const value of ['https://remote.example.test', 'http://127.0.0.1.evil.test', 'http://0.0.0.0:3000']) {
  test(`blocks remote writes: ${value}`, () => assert.throws(() => assertWriteTarget(value, true)));
}
test('requires explicit disposable-environment acknowledgment', () => assert.throws(() => assertWriteTarget('http://localhost:5173', false)));
test('allows explicitly acknowledged disposable local target', () => assert.equal(assertWriteTarget('http://127.0.0.1:5173', true), 'http://127.0.0.1:5173'));
