import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { readNapiTargets } from '../scripts/lib/napi-targets.mjs';
import {
  checkInstalledPlatformPackages,
  detectPlatformPackages,
  expectedPlatformPackageSet,
  formatCauseChain,
  readFrozenManifest,
  requireNativeSuffix,
  resolveSmokeMode,
  selectedPlatformPackages,
  selectTarballs,
  settleLoaderSelection,
} from '../scripts/test-package.mjs';

const frozen = {
  version: '1.2.3',
  packages: {
    'cadmpeg-ts': { filename: 'cadmpeg-ts-1.2.3.tgz', integrity: 'sha512-root', version: '1.2.3' },
    'cadmpeg-ts-example-arch': {
      filename: 'cadmpeg-ts-example-arch-1.2.3.tgz',
      integrity: 'sha512-platform',
      version: '1.2.3',
    },
  },
};

describe('native suffix', () => {
  it('should return the suffix the caller named', () => {
    assert.equal(requireNativeSuffix({ CADMPEG_TS_NATIVE_SUFFIX: 'example-arch' }), 'example-arch');
  });

  it('should reject an unset suffix', () => {
    assert.throws(() => requireNativeSuffix({}), {
      name: 'Error',
      message: /CADMPEG_TS_NATIVE_SUFFIX/u,
    });
  });

  it('should reject an empty suffix', () => {
    assert.throws(() => requireNativeSuffix({ CADMPEG_TS_NATIVE_SUFFIX: '' }), {
      message: /CADMPEG_TS_NATIVE_SUFFIX/u,
    });
  });

  it('should reject a suffix that cannot name a platform package', () => {
    assert.throws(() => requireNativeSuffix({ CADMPEG_TS_NATIVE_SUFFIX: 'Example Arch' }), {
      message: /not a platform suffix: Example Arch/u,
    });
  });
});

describe('smoke mode', () => {
  it('should select tarball mode when a tarball directory is named', () => {
    assert.deepEqual(resolveSmokeMode({ CADMPEG_TS_TARBALL_DIR: 'tarballs' }), {
      kind: 'tarball',
      directory: 'tarballs',
    });
  });

  it('should select registry mode when a published version is named', () => {
    assert.deepEqual(resolveSmokeMode({ CADMPEG_TS_REGISTRY_VERSION: '1.2.3' }), {
      kind: 'registry',
      version: '1.2.3',
    });
  });

  it('should reject a run that names neither input', () => {
    assert.throws(() => resolveSmokeMode({}), {
      message: /exactly one of CADMPEG_TS_TARBALL_DIR .+ or CADMPEG_TS_REGISTRY_VERSION/u,
    });
  });

  it('should reject a run that names both inputs', () => {
    assert.throws(
      () => resolveSmokeMode({ CADMPEG_TS_TARBALL_DIR: 'tarballs', CADMPEG_TS_REGISTRY_VERSION: '1.2.3' }),
      { message: /exactly one of CADMPEG_TS_TARBALL_DIR .+ or CADMPEG_TS_REGISTRY_VERSION/u },
    );
  });
});

describe('frozen tarball selection', () => {
  it('should select the root and platform tarballs recorded for the named suffix', () => {
    assert.deepEqual(selectTarballs(frozen, 'example-arch'), {
      platformName: 'cadmpeg-ts-example-arch',
      platformTarball: 'cadmpeg-ts-example-arch-1.2.3.tgz',
      rootTarball: 'cadmpeg-ts-1.2.3.tgz',
      version: '1.2.3',
    });
  });

  it('should reject a manifest with no entry for the named suffix', () => {
    assert.throws(() => selectTarballs(frozen, 'other-arch'), {
      message: /no tarball for cadmpeg-ts-other-arch/u,
    });
  });

  it('should reject a platform tarball packed at another version', () => {
    const drifted = {
      ...frozen,
      packages: {
        ...frozen.packages,
        'cadmpeg-ts-example-arch': { ...frozen.packages['cadmpeg-ts-example-arch'], version: '1.2.4' },
      },
    };
    assert.throws(() => selectTarballs(drifted, 'example-arch'), {
      message: /cadmpeg-ts-example-arch is packed at 1\.2\.4, expected 1\.2\.3/u,
    });
  });

  it('should reject an entry with no filename', () => {
    const nameless = {
      ...frozen,
      packages: { ...frozen.packages, 'cadmpeg-ts': { integrity: 'sha512-root', version: '1.2.3' } },
    };
    assert.throws(() => selectTarballs(nameless, 'example-arch'), {
      message: /cadmpeg-ts records no tarball filename/u,
    });
  });

  it('should reject a manifest with no version', () => {
    assert.throws(() => selectTarballs({ packages: frozen.packages }, 'example-arch'), {
      message: /records no version/u,
    });
  });

  it('should reject a manifest with no packages', () => {
    assert.throws(() => selectTarballs({ version: '1.2.3' }, 'example-arch'), {
      message: /records no packages/u,
    });
  });
});

describe('installed platform packages', () => {
  const configured = ['cadmpeg-ts', 'cadmpeg-ts-first-arch', 'cadmpeg-ts-second-arch'];

  it('should return every installed platform package in sorted order', () => {
    assert.deepEqual(
      detectPlatformPackages(
        ['cadmpeg-ts-second-arch', '.package-lock.json', 'cadmpeg-ts-first-arch'],
        configured,
      ),
      ['cadmpeg-ts-first-arch', 'cadmpeg-ts-second-arch'],
    );
  });

  it('should ignore the root package and unrelated dependencies', () => {
    assert.deepEqual(detectPlatformPackages(['cadmpeg-ts', '.bin'], configured), []);
  });

  it('should ignore an installed dependency that only shares the root prefix', () => {
    // `cadmpeg-ts-adjacent-tool` reads like a platform package and is not one:
    // counting it would report two platform packages and fail a clean smoke.
    assert.deepEqual(
      detectPlatformPackages(['cadmpeg-ts-adjacent-tool', 'cadmpeg-ts-first-arch'], configured),
      ['cadmpeg-ts-first-arch'],
    );
  });

  it('should return no platform package when the release configures none', () => {
    assert.deepEqual(detectPlatformPackages(['cadmpeg-ts-first-arch'], ['cadmpeg-ts']), []);
  });
});

describe('platform package rule', () => {
  // NAPI-RS emits `libc` for the `gnu` and `musl` ABIs only, so the two
  // `eabihf` rows carry none and npm installs both on any armv7 host.
  const targets = [
    { cpu: 'arm64', name: 'cadmpeg-ts-darwin-arm64', os: 'darwin', suffix: 'darwin-arm64' },
    { cpu: 'arm', name: 'cadmpeg-ts-linux-arm-gnueabihf', os: 'linux', suffix: 'linux-arm-gnueabihf' },
    { cpu: 'arm', name: 'cadmpeg-ts-linux-arm-musleabihf', os: 'linux', suffix: 'linux-arm-musleabihf' },
    { cpu: 'x64', libc: 'glibc', name: 'cadmpeg-ts-linux-x64-gnu', os: 'linux', suffix: 'linux-x64-gnu' },
    { cpu: 'x64', libc: 'musl', name: 'cadmpeg-ts-linux-x64-musl', os: 'linux', suffix: 'linux-x64-musl' },
  ];
  const ruleFor = (suffix) => expectedPlatformPackageSet(suffix, targets);

  it('should name the libc-less sibling npm installs beside an armv7 package', () => {
    assert.deepEqual(ruleFor('linux-arm-gnueabihf'), {
      expected: 'cadmpeg-ts-linux-arm-gnueabihf',
      siblings: ['cadmpeg-ts-linux-arm-musleabihf'],
    });
    assert.deepEqual(ruleFor('linux-arm-musleabihf'), {
      expected: 'cadmpeg-ts-linux-arm-musleabihf',
      siblings: ['cadmpeg-ts-linux-arm-gnueabihf'],
    });
  });

  it('should name no sibling for a package a libc selector splits', () => {
    assert.deepEqual(ruleFor('linux-x64-gnu'), { expected: 'cadmpeg-ts-linux-x64-gnu', siblings: [] });
    assert.deepEqual(ruleFor('darwin-arm64'), { expected: 'cadmpeg-ts-darwin-arm64', siblings: [] });
  });

  it('should reject a suffix the release configures no package for', () => {
    assert.throws(() => ruleFor('linux-mips-gnu'), {
      message: /configures no cadmpeg-ts-linux-mips-gnu/u,
    });
  });

  it('should derive exactly the armv7 twins from the configured targets', () => {
    // The rule stands on the generated selectors rather than on two hard-coded
    // names; this is where a change to `napi.targets` has to be noticed.
    const { packages } = readNapiTargets(new URL('../package.json', import.meta.url));
    const withSiblings = packages
      .map((target) => expectedPlatformPackageSet(target.suffix, packages))
      .filter((rule) => rule.siblings.length > 0)
      .map((rule) => rule.expected);

    assert.deepEqual(withSiblings, ['cadmpeg-ts-linux-arm-gnueabihf', 'cadmpeg-ts-linux-arm-musleabihf']);
  });

  it('should accept both armv7 packages for either expected suffix', () => {
    const installed = ['cadmpeg-ts-linux-arm-gnueabihf', 'cadmpeg-ts-linux-arm-musleabihf'];

    assert.equal(
      checkInstalledPlatformPackages(installed, ruleFor('linux-arm-gnueabihf')),
      'cadmpeg-ts-linux-arm-gnueabihf beside cadmpeg-ts-linux-arm-musleabihf',
    );
    assert.equal(
      checkInstalledPlatformPackages(installed, ruleFor('linux-arm-musleabihf')),
      'cadmpeg-ts-linux-arm-musleabihf beside cadmpeg-ts-linux-arm-gnueabihf',
    );
  });

  it('should accept the expected package on its own', () => {
    assert.equal(
      checkInstalledPlatformPackages(['cadmpeg-ts-linux-x64-gnu'], ruleFor('linux-x64-gnu')),
      'cadmpeg-ts-linux-x64-gnu',
    );
  });

  it('should reject a second package a libc selector should have excluded', () => {
    assert.throws(
      () =>
        checkInstalledPlatformPackages(
          ['cadmpeg-ts-linux-x64-gnu', 'cadmpeg-ts-linux-x64-musl'],
          ruleFor('linux-x64-gnu'),
        ),
      { message: /installed: cadmpeg-ts-linux-x64-gnu, cadmpeg-ts-linux-x64-musl/u },
    );
  });

  it('should reject an install the expected package is missing from', () => {
    assert.throws(
      () =>
        checkInstalledPlatformPackages(['cadmpeg-ts-linux-arm-musleabihf'], ruleFor('linux-arm-gnueabihf')),
      { message: /expected the platform package cadmpeg-ts-linux-arm-gnueabihf/u },
    );
    assert.throws(() => checkInstalledPlatformPackages([], ruleFor('linux-x64-gnu')), {
      message: /installed: none/u,
    });
  });
});

describe('loaded platform package', () => {
  const installed = ['cadmpeg-ts-linux-arm-gnueabihf', 'cadmpeg-ts-linux-arm-musleabihf'];

  it('should name the package whose binding the loader opened', () => {
    assert.deepEqual(
      selectedPlatformPackages(
        [
          '/usr/bin/node',
          '/usr/lib/arm-linux-gnueabihf/libvulkan.so.1',
          '/work/node_modules/cadmpeg-ts-linux-arm-gnueabihf/cadmpeg-ts.linux-arm-gnueabihf.node',
        ],
        installed,
      ),
      ['cadmpeg-ts-linux-arm-gnueabihf'],
    );
  });

  it('should read a Windows module path', () => {
    assert.deepEqual(
      selectedPlatformPackages(
        ['C:\\work\\node_modules\\cadmpeg-ts-win32-x64-msvc\\cadmpeg-ts.win32-x64-msvc.node'],
        ['cadmpeg-ts-win32-x64-msvc'],
      ),
      ['cadmpeg-ts-win32-x64-msvc'],
    );
  });

  it('should report every platform package the loader opened', () => {
    assert.deepEqual(
      selectedPlatformPackages(
        installed.map((name) => `/work/node_modules/${name}/cadmpeg-ts.node`),
        installed,
      ),
      installed,
    );
  });

  it('should ignore a shared object that is not a platform binding', () => {
    assert.deepEqual(
      selectedPlatformPackages(
        [
          '/work/node_modules/cadmpeg-ts-linux-arm-gnueabihf/package.json',
          '/work/node_modules/other-addon/other.node',
        ],
        installed,
      ),
      [],
    );
  });
});

describe('loader selection', () => {
  const twins = ['cadmpeg-ts-linux-arm-gnueabihf', 'cadmpeg-ts-linux-arm-musleabihf'];
  const [expected, sibling] = twins;

  it('should report the package whose binding is open', () => {
    assert.equal(settleLoaderSelection([expected], expected, twins), `loader selected: ${expected}`);
  });

  it('should reject a binding from any other installed package', () => {
    assert.throws(() => settleLoaderSelection([sibling], expected, twins), {
      message: new RegExp(`opened ${sibling}, expected ${expected}`, 'u'),
    });
  });

  it('should demand a binding where npm installed more than one package', () => {
    assert.throws(() => settleLoaderSelection([], expected, twins), {
      message: /no platform binding.+nothing proves it selected/su,
    });
  });

  it('should tolerate a runtime that lists no addon when one package is installed', () => {
    // Windows lists no addon among its shared objects before Node 22.14, and
    // 22.13.0 is the supported floor. Where npm resolved a single package there
    // is nothing to choose between, so the install listing is proof enough.
    assert.match(settleLoaderSelection([], expected, [expected]), /lists no addon/u);
  });
});

describe('frozen tarball directory', () => {
  const scratch = () => mkdtempSync(join(tmpdir(), 'cadmpeg-ts-tarball-dir-'));

  it('should read the manifest a populated directory holds', () => {
    const directory = scratch();
    writeFileSync(join(directory, 'test-tarballs.json'), JSON.stringify(frozen));
    assert.deepEqual(readFrozenManifest(directory), frozen);
  });

  it('should name the directory an unpacked download never created', () => {
    const missing = join(scratch(), 'never-landed');
    assert.throws(() => readFrozenManifest(missing), {
      message: new RegExp(`no tarball directory: ${missing.replaceAll('\\\\', '\\\\\\\\')}`, 'u'),
    });
  });

  it('should report an empty directory as empty rather than as a missing file', () => {
    const directory = scratch();
    assert.throws(() => readFrozenManifest(directory), {
      message: new RegExp(`${directory.replaceAll('\\\\', '\\\\\\\\')} is empty`, 'u'),
    });
  });

  it('should list what did land when the manifest is absent', () => {
    const directory = scratch();
    writeFileSync(join(directory, 'cadmpeg-ts-1.2.3.tgz'), '');
    assert.throws(() => readFrozenManifest(directory), {
      message: /test-tarballs\.json.*holds: cadmpeg-ts-1\.2\.3\.tgz/su,
    });
  });
});

describe('cause chain formatting', () => {
  it('should print the message and stack of every error in the chain', () => {
    const root = new Error('native binding missing');
    const middle = new Error('cannot find native binding', { cause: root });
    const top = new Error('adapter unavailable', { cause: middle });

    const report = formatCauseChain(top);

    assert.match(report, /^error: adapter unavailable$/mu);
    assert.match(report, /^cause 1: cannot find native binding$/mu);
    assert.match(report, /^cause 2: native binding missing$/mu);
    assert.ok(report.includes(root.stack), 'the deepest stack is reported');
  });

  it('should print a cause that is not an error', () => {
    const report = formatCauseChain(new Error('adapter unavailable', { cause: 'ENOENT' }));

    assert.match(report, /^cause 1: ENOENT$/mu);
  });

  it('should stop at a cause cycle', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });
    first.cause = second;

    const report = formatCauseChain(second);

    assert.equal(report.match(/^cause \d+: /gmu)?.length, 1);
    assert.match(report, /^cause 1: first$/mu);
  });

  it('should print a thrown value that is not an error', () => {
    assert.match(formatCauseChain('exploded'), /^error: exploded$/mu);
  });
});
