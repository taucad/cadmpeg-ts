import { describe, expect, it } from 'vitest';

import { PACKAGE_FILES, validatePackageFiles } from '../scripts/package-files.mjs';

describe('npm package file contract', () => {
  it('should accept exactly the public package files', () => {
    expect(validatePackageFiles([...PACKAGE_FILES].reverse())).toEqual(PACKAGE_FILES);
  });

  it('should ship the generated loader, the Node entry point and every format module', () => {
    expect(PACKAGE_FILES).toContain('dist/native/index.js');
    expect(PACKAGE_FILES).toContain('dist/index.node.mjs');
    expect(PACKAGE_FILES).toContain('dist/index.node.d.mts');
    expect(PACKAGE_FILES).toContain('dist/formats.mjs');
    for (const id of ['step', 'sldprt', 'catia', 'rhino']) {
      expect(PACKAGE_FILES).toContain(`dist/wasm/${id}.js`);
      expect(PACKAGE_FILES).toContain(`dist/wasm/${id}_bg.wasm`);
    }
    // The loader declarations are a build input, not shipped output.
    expect(PACKAGE_FILES).not.toContain('dist/native/index.d.ts');
  });

  it('should reject missing, extra, and source files', () => {
    expect(() => validatePackageFiles(PACKAGE_FILES.slice(1))).toThrow('missing=[');
    expect(() => validatePackageFiles([...PACKAGE_FILES, 'dist/accidental.txt'])).toThrow('extra=[');
    expect(() => validatePackageFiles([...PACKAGE_FILES, 'rust/src/lib.rs'])).toThrow(
      'forbidden=[rust/src/lib.rs]',
    );
  });

  it.each(['cadmpeg-ts.darwin-arm64.node', 'dist/cadmpeg-ts.linux-x64-gnu.node', 'dist/native/index.d.ts'])(
    'should reject %s in the root tarball',
    (file) => {
      expect(() => validatePackageFiles([...PACKAGE_FILES, file])).toThrow(`forbidden=[${file}]`);
    },
  );
});
