import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;
let cli: string;
let workflow: string;
let prs: string;
beforeAll(() => {
  dir = mkdtempSync(join(process.cwd(), '.caver-cli-test-'));
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--outDir', join(dir, 'dist')]);
  cli = join(dir, 'dist/cli.js');
  workflow = join(dir, 'workflow.yml');
  prs = join(dir, 'prs.json');
  writeFileSync(workflow, `on: pull_request\njobs:\n  danger:\n    steps:\n      - run: touch ${join(dir, 'executed')}\n`);
  writeFileSync(prs, JSON.stringify([{ id: '1', baseBranch: 'main', action: 'opened', changedFiles: [], filesComplete: true }]));
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('platform scope and read-only CLI', () => {
  const run = (platform?: string) => spawnSync(process.execPath, [cli, 'analyze', ...(platform === undefined ? [] : ['--platform', platform]), '--base', workflow, '--proposed', workflow, '--prs', prs], { encoding: 'utf8' });
  it('requires an explicit platform', () => { expect(run().status).not.toBe(0); });
  it('reports GitHub.com scope and does not execute or modify inputs', () => {
    const before = [readFileSync(workflow, 'utf8'), readFileSync(prs, 'utf8')];
    const output = run('github.com');
    expect(output.status).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({ platform: 'github.com', supportedPlatform: 'github.com', comparisons: [{ before: { decision: 'run' } }] });
    expect([readFileSync(workflow, 'utf8'), readFileSync(prs, 'utf8')]).toEqual(before);
    expect(existsSync(join(dir, 'executed'))).toBe(false);
  });
  it('returns unknown for Enterprise Server rather than a GitHub.com prediction', () => {
    const output = run('ghes-3.19');
    expect(output.status).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({ platform: 'ghes-3.19', supportedPlatform: 'github.com', comparisons: [{ before: { decision: 'unknown' }, after: { decision: 'unknown' }, change: 'unknown' }] });
  });
});
