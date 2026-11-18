import { execFileSync } from 'node:child_process';

import { packedModuleFindings, readDigests } from './module-digests.mjs';
import { validatePackageFiles } from './package-files.mjs';

const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }),
);
if (!Array.isArray(packed) || packed.length !== 1) {
  throw new Error('npm pack must describe exactly one tarball');
}

const files = validatePackageFiles(packed[0].files.map(({ path }) => path));
console.log(`npm package contains ${files.length} files within the enforced ceiling`);

// The digest map is generated from the modules it describes; a map that drifts
// from the packed bytes would make every verifying host refuse them.
const findings = packedModuleFindings(await readDigests(process.cwd()), process.cwd());
if (findings.length > 0)
  throw new Error(`cadmpeg-ts/digests disagrees with the packed modules:\n${findings.join('\n')}`);
console.log('cadmpeg-ts/digests matches every packed module');
