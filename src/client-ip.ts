import type { Request } from 'express';

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Informational trace chain; never used to authorize a request. */
export function forwardedClientIp(req: Request): string {
  const existing = req.headers['x-forwarded-for'];
  const chain = Array.isArray(existing) ? existing.join(', ') : existing;
  return chain?.trim() ? `${chain}, ${clientIp(req)}` : clientIp(req);
}
