import { describe, expect, it } from 'vitest';

import { CadmpegError, fromEngine } from '#errors.js';

describe('CadmpegError', () => {
  it('carries a code, a phase and a cause', () => {
    const cause = new Error('inner');
    const error = new CadmpegError('IMPORT_FAILED', 'bad file', { phase: 'decode', cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CadmpegError');
    expect(error.code).toBe('IMPORT_FAILED');
    expect(error.phase).toBe('decode');
    expect(error.cause).toBe(cause);
  });

  it('leaves phase and cause unset by default', () => {
    const error = new CadmpegError('INTERNAL', 'x');
    expect(error.phase).toBeUndefined();
    expect('cause' in error).toBe(false);
  });
});

describe('fromEngine', () => {
  it('passes a CadmpegError through', () => {
    const error = new CadmpegError('ABORTED', 'x');
    expect(fromEngine(error)).toBe(error);
  });

  it('reads binding JSON thrown as a string (WASM)', () => {
    const error = fromEngine('{"code":"REFUSED","message":"no","phase":"export"}');
    expect(error).toMatchObject({ code: 'REFUSED', message: 'no', phase: 'export' });
  });

  it('reads binding JSON carried in an Error message (NAPI)', () => {
    const error = fromEngine(new Error('{"code":"LIMIT_EXCEEDED","message":"too big","phase":"decode"}'));
    expect(error).toMatchObject({ code: 'LIMIT_EXCEEDED', phase: 'decode' });
  });

  it('keeps the JSON text when the message field is missing, and ignores an unknown phase', () => {
    const text = '{"code":"INTERNAL","phase":"elsewhere"}';
    expect(fromEngine(text)).toMatchObject({ code: 'INTERNAL', message: text, phase: undefined });
  });

  it.each([
    ['a trap', new Error('unreachable')],
    ['an unknown code', '{"code":"NOPE","message":"x"}'],
    ['malformed JSON', '{not json'],
    ['a JSON array', '{"code"]'],
    ['a non-object JSON value', '{}'],
    ['a non-error value', 42],
  ])('reports %s as ENGINE_FAILED', (_, thrown) => {
    const error = fromEngine(thrown);
    expect(error.code).toBe('ENGINE_FAILED');
    expect(error.cause).toBe(thrown);
  });
});
