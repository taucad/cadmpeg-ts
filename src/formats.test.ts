import { describe, expect, it } from 'vitest';

import {
  candidateModules,
  crossesAsStep,
  inputs,
  modules,
  outputExtension,
  outputs,
  writerModule,
} from '#formats.js';

describe('formats', () => {
  it('maps every input to a module that carries its codec', () => {
    for (const format of inputs) {
      if (format.id === 'cadir') continue;
      expect(modules[format.module]).toContain(format.id);
    }
  });

  it('gives every module the STEP codec', () => {
    for (const codecs of Object.values(modules)) expect(codecs).toContain('step');
  });

  it.each([
    ['part.SLDPRT', ['sldprt']],
    ['dir/sub\\part.stp', ['step']],
    ['bracket.prt.5', ['creo', 'nx']],
    ['bracket.prt', ['creo', 'nx']],
    ['model.cadir.json', ['step']],
    ['noextension', []],
    ['archive.zip', []],
    [undefined, []],
  ])('chooses candidate modules for %s', (name, expected) => {
    expect(candidateModules(name)).toEqual(expected);
  });

  it('writes STEP and CADIR in the source module, and native formats in their own', () => {
    expect(writerModule('step', 'sldprt')).toBe('sldprt');
    expect(writerModule('cadir', 'catia')).toBe('catia');
    expect(writerModule('sldprt', 'sldprt')).toBe('sldprt');
    expect(writerModule('iges', 'sldprt')).toBe('iges');
    expect(writerModule('rhino', 'step')).toBe('rhino');
    expect(writerModule('obj', 'step')).toBe('step');
  });

  it('crosses as STEP only when the writer module cannot read the source', () => {
    expect(crossesAsStep('usd', 'step')).toBe(false);
    expect(crossesAsStep('rhino', 'step')).toBe(false);
    expect(crossesAsStep('step', 'sldprt')).toBe(false);
    expect(crossesAsStep('cadir', 'catia')).toBe(false);
    expect(crossesAsStep('sldprt', 'sldprt')).toBe(false);
    expect(crossesAsStep('usd', 'sldprt')).toBe(true);
    expect(crossesAsStep('rhino', 'creo')).toBe(true);
    expect(crossesAsStep('obj', 'sldprt')).toBe(false);
  });

  it('names output extensions', () => {
    expect(outputExtension('rhino')).toBe('3dm');
    expect(outputExtension('cadir')).toBe('cadir.json');
    expect(outputExtension('unknown')).toBe('unknown');
    expect(outputs.map((output) => output.id)).toContain('step');
  });
});
