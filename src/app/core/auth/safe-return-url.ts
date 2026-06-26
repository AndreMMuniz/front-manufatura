/**
 * Sanitize a `returnUrl` for the auth redirect flow.
 *
 * Returns the decoded internal path when `returnUrl` is safe, or `null` when
 * it should be dropped (and the caller falls back to its default target).
 *
 * Safety rules:
 * - Must be a non-empty string starting with `/`.
 * - Rejected if, after decoding (once and twice — to defeat double-encoding),
 *   it is protocol-relative (`//`) or the first path segment equals `login`
 *   case-insensitively — that prevents both open-redirect bypasses and
 *   redirect loops back to `/login`.
 * - Returns the decoded value so the validated intent matches the executed
 *   navigation target (the router will not re-encode `%2F` inside a path in
 *   a way that diverges from what was checked here).
 */
export function buildSafeReturnUrl(returnUrl: string | null | undefined): string | null {
  if (typeof returnUrl !== 'string' || returnUrl.length === 0 || !returnUrl.startsWith('/')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(returnUrl);
  } catch {
    return null;
  }

  // Validate every decode level until the value stabilizes. This prevents
  // bypasses where a dangerous value is encoded many times.
  let candidate = decoded;
  while (true) {
    if (candidate.startsWith('//')) {
      return null;
    }
    const pathOnly = candidate.split('#')[0].split('?')[0];
    const segments = pathOnly.split('/').filter(Boolean);
    if (segments.some(segment => segment === '.' || segment === '..')) {
      return null;
    }
    const firstSegment = segments[0]?.split(';')[0];
    if (firstSegment !== undefined && firstSegment.toLowerCase() === 'login') {
      return null;
    }

    let next: string;
    try {
      next = decodeURIComponent(candidate);
    } catch {
      return null;
    }
    if (next === candidate) {
      break;
    }
    candidate = next;
  }

  return candidate;
}
