import { CadmpegError, convert, convertFormats, createCadmpeg } from 'cadmpeg-ts';
import { beforeAll, expect, test } from 'vitest';

let step;
let sldprt;

const fixture = async (name) => {
  const response = await fetch(new URL(`../fixtures/${name}`, import.meta.url));
  expect(response.ok).toBe(true);
  return new Uint8Array(await response.arrayBuffer());
};

const text = (bytes, length) => new TextDecoder().decode(bytes.subarray(0, length));

beforeAll(async () => {
  step = await fixture('nist_ctc_01_asme1_ap242-e1.stp');
  sldprt = await fixture('nist_ftc_06_asme1_rd_sw1802.SLDPRT');
});

test('converts STEP through the step module', async () => {
  const result = await convert({ name: 'ctc01.stp', bytes: step }, { to: 'step' });
  expect(result.backend).toBe('wasm');
  expect(result.from).toBe('step');
  expect(result.files[0].name).toBe('ctc01.step');
  expect(text(result.files[0].bytes, 13)).toBe('ISO-10303-21;');
});

test('converts SOLIDWORKS to STEP through the sldprt module, deterministically', async () => {
  const first = await convert({ name: 'ftc06.SLDPRT', bytes: sldprt }, { to: 'step' });
  const second = await convert({ name: 'ftc06.SLDPRT', bytes: sldprt }, { to: 'step' });
  expect(first.from).toBe('sldprt');
  expect(text(first.files[0].bytes, 13)).toBe('ISO-10303-21;');
  expect(first.files[0].bytes).toEqual(second.files[0].bytes);
  for (const loss of first.losses) {
    expect(['decode', 'export']).toContain(loss.phase);
    expect(typeof loss.code).toBe('string');
  }
});

test('routes a native-to-native conversion through STEP', async () => {
  const [iges, rhino] = await convertFormats(
    { name: 'ftc06.SLDPRT', bytes: sldprt },
    { targets: [{ to: 'iges' }, { to: 'rhino' }] },
  );
  expect(iges.to).toBe('iges');
  expect(iges.files[0].name).toBe('ftc06.iges');
  expect(rhino.to).toBe('rhino');
  expect(rhino.files[0].name).toBe('ftc06.3dm');
});

test('rejects with stable codes', async () => {
  const engine = await createCadmpeg({ backend: 'wasm' });
  await expect(engine.convert({ name: 'a.obj', bytes: step }, { to: 'step' })).rejects.toMatchObject({
    code: 'UNSUPPORTED_FORMAT',
  });
  await expect(engine.convert({ name: 'a.stp', bytes: step }, { to: 'obj' })).rejects.toBeInstanceOf(
    CadmpegError,
  );
  await expect(createCadmpeg({ backend: 'native' })).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
});
