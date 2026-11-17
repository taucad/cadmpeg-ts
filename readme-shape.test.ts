import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const README = readFileSync(resolve(import.meta.dirname, 'README.md'), 'utf8');
const LINE_BUDGET = 220; // Origin: bounded persona-routed top page in opencascade.js.
const WORD_BUDGET = 400; // The npm page: quick start, one raw sentence, one reuse example.
const REQUIRED = [
  '## Install',
  '## Quick start',
  '## Compatibility',
  '## Versioning and stability',
  '## Security and provenance',
  '## Links',
  '## License',
] as const;

describe('README shape', () => {
  it('should stay within the persona-routed line budget', () => {
    expect(README.split('\n').length).toBeLessThanOrEqual(LINE_BUDGET);
  });

  it('should stay within the word budget', () => {
    expect(README.split(/\s+/u).filter(Boolean).length).toBeLessThanOrEqual(WORD_BUDGET);
  });

  it('should state the unofficial status and route readers to compatibility before the first section', () => {
    const firstSection = README.search(/^## /mu);
    expect(README.indexOf('unofficial')).toBeGreaterThanOrEqual(0);
    expect(README.indexOf('unofficial')).toBeLessThan(firstSection);
    expect(README.indexOf('(compatibility.md)')).toBeLessThan(firstSection);
  });

  it.each(REQUIRED)('should contain %s', (section) => {
    expect(README).toContain(section);
  });

  it('should contain a runnable public quick start and maintainer link', () => {
    expect(README).toContain("from 'cadmpeg-ts'");
    expect(README).toContain('(MAINTAINER.md)');
  });
});
