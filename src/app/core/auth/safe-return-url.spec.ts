import { describe, expect, it } from 'vitest';

import { buildSafeReturnUrl } from './safe-return-url';

describe('buildSafeReturnUrl', () => {
  it('returns null for non-string or empty input', () => {
    expect(buildSafeReturnUrl(null)).toBeNull();
    expect(buildSafeReturnUrl(undefined)).toBeNull();
    expect(buildSafeReturnUrl('')).toBeNull();
    expect(buildSafeReturnUrl('   ')).toBeNull();
  });

  it('rejects values that do not start with /', () => {
    expect(buildSafeReturnUrl('https://evil.example/path')).toBeNull();
    expect(buildSafeReturnUrl('menu')).toBeNull();
  });

  it('accepts a safe internal path', () => {
    expect(buildSafeReturnUrl('/quality-control')).toBe('/quality-control');
    expect(buildSafeReturnUrl('/orders/42')).toBe('/orders/42');
  });

  it('rejects protocol-relative URLs', () => {
    expect(buildSafeReturnUrl('//evil.example/path')).toBeNull();
  });

  it('rejects single-encoded protocol-relative URLs', () => {
    expect(buildSafeReturnUrl('/%2F%2Fevil.example')).toBeNull();
    // `/%2Fevil.example` decodes to `//evil.example` — same protocol-relative shape
    expect(buildSafeReturnUrl('/%2Fevil.example')).toBeNull();
  });

  it('rejects double-encoded protocol-relative URLs', () => {
    expect(buildSafeReturnUrl('/%252F%252Fevil.example')).toBeNull();
  });

  it('rejects protocol-relative URLs encoded more than twice', () => {
    expect(buildSafeReturnUrl('/%25252F%25252Fevil.example')).toBeNull();
  });

  it('rejects /login and any path whose first segment is login (case-insensitive)', () => {
    expect(buildSafeReturnUrl('/login')).toBeNull();
    expect(buildSafeReturnUrl('/Login')).toBeNull();
    expect(buildSafeReturnUrl('/LOGIN')).toBeNull();
    expect(buildSafeReturnUrl('/login/foo')).toBeNull();
  });

  it('accepts a route that starts with the substring "login" but is a distinct segment', () => {
    expect(buildSafeReturnUrl('/loginhelp')).toBe('/loginhelp');
    expect(buildSafeReturnUrl('/login-support')).toBe('/login-support');
  });

  it('returns the decoded value so validated intent matches executed target', () => {
    expect(buildSafeReturnUrl('/quality-control%2Freports')).toBe('/quality-control/reports');
  });
});
