// Diagnostic only: one long-lived process converting repeatedly, as the smoke does.
import { readFile } from 'node:fs/promises';
import { createCadmpeg } from 'cadmpeg-ts';
const [backend, to, file, times] = process.argv.slice(2);
const engine = await createCadmpeg({ backend });
const bytes = new Uint8Array(await readFile(file));
for (let i = 0; i < Number(times); i++) {
  try {
    const r = await engine.convert({ name: 'part.sldprt', bytes }, { to });
    console.log(`loop ${i} ok ${r.files[0].bytes.length}`);
  } catch (error) {
    console.log(`loop ${i} refused ${error?.code} ${error?.message}`);
  }
}
