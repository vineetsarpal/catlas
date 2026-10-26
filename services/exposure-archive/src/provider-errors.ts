import { ArchiveError } from './types';

/** Recognized provider signals only; credentials, generic 403s and cold starts are not quotas. */
export function providerFailure(error: unknown, provider: 'R2' | 'Neon'): ArchiveError | null {
  if (error instanceof ArchiveError) return error;
  const message = error instanceof Error ? error.message : '';
  const quota = provider === 'R2' ? /\(10058\)\s*$/.test(message) : /HTTP status (?:429|402)\b/.test(message);
  const suspended = provider === 'R2' ? /\(10042\)\s*$/.test(message) : /\b(?:project|endpoint) (?:is |has been )?(?:disabled|suspended)\b/i.test(message);
  if (quota) return new ArchiveError('provider_quota', `${provider} is limiting requests or has exhausted a provider allowance. Retry explicitly later.`, 503);
  if (suspended) return new ArchiveError('provider_suspended', `${provider} access is disabled or suspended. Existing evidence remains retained; contact the operator.`, 503);
  return null;
}
