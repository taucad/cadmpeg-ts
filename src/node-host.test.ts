import { describe, expect, it } from 'vitest';

import { readPackagedModule } from '#node-host.js';

describe('readPackagedModule', () => {
  it('reads the binary beside the package, or fails when it is not built', async () => {
    const outcome = await readPackagedModule('step').then(
      (bytes) => bytes instanceof Uint8Array,
      (error: unknown) => (error as NodeJS.ErrnoException).code,
    );
    expect([true, 'ENOENT']).toContain(outcome);
  });
});
