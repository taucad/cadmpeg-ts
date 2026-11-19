// Diagnostic only (not for merge): one backend, one writer, one process.
import { readFile } from 'node:fs/promises';
import { createCadmpeg } from 'cadmpeg-ts';
const [backend, to, file] = process.argv.slice(2);
const engine = await createCadmpeg({ backend });
const bytes = new Uint8Array(await readFile(file));
const name = file.toLowerCase().endsWith('.sldprt') ? 'part.sldprt' : 'part.stp';
try {
  const result = await engine.convert({ name, bytes }, { to });
  console.log(`ok ${backend} ${to}: ${result.files.map((f) => `${f.name} ${f.bytes.length}`).join(', ')}`);
} catch (error) {
  console.log(`refused ${backend} ${to}: ${error?.code} ${error?.message}`);
}
