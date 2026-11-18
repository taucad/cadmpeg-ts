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
  // cadmpeg's IGES and Rhino writers refuse a model that carries features or
  // PMI, so the native-to-native route is checked with OpenUSD.
  const [usd] = await convertFormats({ name: 'ftc06.SLDPRT', bytes: sldprt }, { targets: [{ to: 'usd' }] });
  expect(usd.to).toBe('usd');
  expect(usd.files[0].name).toBe('ftc06.usda');
  expect(new TextDecoder().decode(usd.files[0].bytes.subarray(0, 5))).toBe('#usda');
});

test('rejects with stable codes', async () => {
  const engine = await createCadmpeg({ backend: 'wasm' });
  // Detection reads the bytes, so the input must not be STEP whatever its name.
  const obj = new TextEncoder().encode('v 0 0 0\n');
  await expect(engine.convert({ name: 'a.obj', bytes: obj }, { to: 'step' })).rejects.toMatchObject({
    code: 'UNSUPPORTED_FORMAT',
  });
  await expect(engine.convert({ name: 'a.stp', bytes: step }, { to: 'obj' })).rejects.toBeInstanceOf(
    CadmpegError,
  );
  await expect(createCadmpeg({ backend: 'native' })).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
});
