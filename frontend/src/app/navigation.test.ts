import { describe, expect, it } from 'vitest';
import { workspaceModeFromUrl } from './navigation';

describe('workbench URL navigation', () => {
  it.each(['portfolios', 'monitor', 'exposure', 'recovery'] as const)('opens an explicitly selected %s workspace from either entry page', mode => {
    for (const path of ['/', '/exposure.html']) {
      expect(workspaceModeFromUrl(new URL(`https://catlas.example${path}?other=retained&mode=${mode}`))).toBe(mode);
    }
  });
  it('falls back to the page workspace for missing or unsupported modes, including history navigation', () => {
    for (const query of ['', '?mode=', '?mode=unknown']) {
      expect(workspaceModeFromUrl(new URL(`https://catlas.example/${query}`))).toBe('portfolios');
      expect(workspaceModeFromUrl(new URL(`https://catlas.example/exposure.html${query}`))).toBe('exposure');
    }
  });
  it('honors the entry page default when explicitly supplied', () => {
    expect(workspaceModeFromUrl(new URL('https://catlas.example/custom-entry'), 'exposure')).toBe('exposure');
    expect(workspaceModeFromUrl(new URL('https://catlas.example/custom-entry?mode=recovery'), 'exposure')).toBe('recovery');
  });
});
