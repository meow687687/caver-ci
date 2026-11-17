import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/cli.js';
import type { GitHubRepositoryHistory } from '../src/github.js';

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
  const run = (platform?: string, fixtureFile = prs, baseFile = workflow) => spawnSync(process.execPath, [cli, 'analyze', ...(platform === undefined ? [] : ['--platform', platform]), '--base', baseFile, '--proposed', workflow, '--prs', fixtureFile], { encoding: 'utf8' });
  it('requires an explicit platform', () => { expect(run().status).not.toBe(0); });
  it('reports GitHub.com scope and does not execute or modify inputs', () => {
    const before = [readFileSync(workflow, 'utf8'), readFileSync(prs, 'utf8')];
    const output = run('github.com');
    expect(output.status).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({ platform: 'github.com', supportedPlatform: 'github.com', comparisons: [{ before: { decision: 'run' } }] });
    expect(Object.keys(JSON.parse(output.stdout))).toEqual(['platform', 'supportedPlatform', 'comparisons']);
    expect([readFileSync(workflow, 'utf8'), readFileSync(prs, 'utf8')]).toEqual(before);
    expect(existsSync(join(dir, 'executed'))).toBe(false);
  });
  it.skipIf(process.platform === 'win32')('runs through a package-style symlink to the compiled CLI', () => {
    const cliLink = join(dir, 'caver-ci-bin');
    symlinkSync(cli, cliLink);
    const output = spawnSync(process.execPath, [cliLink, '--help'], { encoding: 'utf8' });
    expect(output.status).toBe(0);
    expect(output.stdout).toContain('Compare pull request trigger eligibility');
  });
  it('renders empty and mixed samples as a readable text report while JSON remains the default', () => {
    const original = join(dir, 'original.yml');
    const proposed = join(dir, 'proposed.yml');
    const mixed = join(dir, 'mixed.json');
    writeFileSync(original, "on:\n  pull_request:\n    paths: ['src/**']\n");
    writeFileSync(proposed, "on:\n  pull_request:\n    paths: ['docs/**']\n");
    writeFileSync(mixed, JSON.stringify([
      { id: 'skip-me', baseBranch: 'main', action: 'opened', changedFiles: ['src/a.ts'], filesComplete: true },
      { id: 'trigger-me', baseBranch: 'main', action: 'opened', changedFiles: ['docs/a.md'], filesComplete: true },
      { id: 'same', baseBranch: 'main', action: 'opened', changedFiles: ['other/a.txt'], filesComplete: true },
      { id: 'uncertain', baseBranch: 'main', action: 'opened', changedFiles: [], filesComplete: false },
    ]));
    const output = spawnSync(process.execPath, [cli, 'analyze', '--platform', 'github.com', '--base', original, '--proposed', proposed, '--prs', mixed, '--format', 'text'], { encoding: 'utf8' });
    expect(output.status).toBe(0);
    expect(output.stdout).toContain('Evaluated repo: offline fixtures (repository not specified)');
    expect(output.stdout).toContain('Sample size: 4');
    expect(output.stdout).toContain('Newly skipped: 1 · Newly triggered: 1 · Unchanged: 1 · Unknown: 1');
    expect(output.stdout).toContain('#skip-me  run → skip  (newly skipped)');
    expect(output.stdout).toContain('#trigger-me  skip → run  (newly triggered)');
    expect(output.stdout).toContain('#uncertain  unknown');
    expect(output.stdout).toContain('Changed file list is incomplete');
    expect(output.stdout).toContain('do not report observed workflow executions or guarantee CI savings');

    const empty = join(dir, 'empty.json');
    writeFileSync(empty, '[]');
    const emptyOutput = spawnSync(process.execPath, [cli, 'analyze', '--platform', 'github.com', '--base', original, '--proposed', proposed, '--prs', empty, '--format', 'text'], { encoding: 'utf8' });
    expect(emptyOutput.status).toBe(0);
    expect(emptyOutput.stdout).toContain('Sample size: 0');
    expect(emptyOutput.stdout).toContain('No pull requests were available in this sample.');
  });
  it('returns unknown for Enterprise Server rather than a GitHub.com prediction', () => {
    const output = run('ghes-3.19');
    expect(output.status).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({ platform: 'ghes-3.19', supportedPlatform: 'github.com', comparisons: [{ before: { decision: 'unknown' }, after: { decision: 'unknown' }, change: 'unknown' }] });
  });
  it('reports invalid fixture fields without a stack trace', () => {
    const invalidFixtures = join(dir, 'invalid-prs.json');
    writeFileSync(invalidFixtures, JSON.stringify([{ id: '1', baseBranch: '', action: 'opened', changedFiles: [], filesComplete: true }]));
    const output = run('github.com', invalidFixtures);
    expect(output.status).not.toBe(0);
    expect(output.stderr).toContain('index 0: expected non-empty baseBranch');
    expect(output.stderr).not.toMatch(/\n\s+at\s/);
  });
  it('reports invalid JSON and unreadable files as CLI errors', () => {
    const invalidJson = join(dir, 'malformed-prs.json');
    writeFileSync(invalidJson, '[');
    const jsonOutput = run('github.com', invalidJson);
    expect(jsonOutput.status).not.toBe(0);
    expect(jsonOutput.stderr).toContain('Error:');
    expect(jsonOutput.stderr).not.toMatch(/\n\s+at\s/);

    const fileOutput = run('github.com', prs, join(dir, 'missing-workflow.yml'));
    expect(fileOutput.status).not.toBe(0);
    expect(fileOutput.stderr).toContain('Error:');
    expect(fileOutput.stderr).not.toMatch(/\n\s+at\s/);
  });

  it('supports GitHub REST mode with its explicit hypothetical scenario and no token in output', async () => {
    const history: GitHubRepositoryHistory = {
      owner: 'acme', repository: 'demo', requestedLimit: 50,
      pullRequestListComplete: false, pullRequestListHasMore: true,
      pullRequestListIncompleteReason: null,
      pullRequests: [{
        number: 10, id: '10', title: 'Example', url: 'https://github.com/acme/demo/pull/10',
        state: 'closed', draft: false, merged: true,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
        baseBranch: 'main', hypotheticalAction: 'opened',
        fixture: { id: '10', baseBranch: 'main', action: 'opened', changedFiles: ['src/app.ts'], filesComplete: true },
        changedFileCount: 1, changedFiles: [{ filename: 'src/app.ts', status: 'modified', previousFilename: null }],
        filesComplete: true, filesIncompleteReason: null,
      }],
    };
    let received: { repo: string; limit: number; token: string | undefined } | undefined;
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('GITHUB_TOKEN', 'cli-test-secret');
    try {
      const program = createProgram(async (repo, limit, options) => {
        received = { repo, limit, token: options.token };
        return history;
      });
      await program.parseAsync([
        'node', 'caver-ci', 'analyze', '--repo', 'acme/demo', '--platform', 'github.com',
        '--base', workflow, '--proposed', workflow,
      ]);
      expect(received).toEqual({ repo: 'acme/demo', limit: 50, token: 'cli-test-secret' });
      const result = JSON.parse(String(output.mock.calls[0]?.[0]));
      expect(result).toMatchObject({
        mode: 'github-rest',
        repository: 'acme/demo',
        pullRequestListComplete: false,
        eventScenario: { action: 'opened', actionIsHypothetical: true },
        comparisons: [{ id: '10', baseBranch: 'main', filesComplete: true, before: { decision: 'run' } }],
      });
      expect(String(output.mock.calls[0]?.[0])).not.toContain('cli-test-secret');

      await createProgram(async () => history).parseAsync([
        'node', 'caver-ci', 'analyze', '--repo', 'acme/demo', '--platform', 'github.com',
        '--base', workflow, '--proposed', workflow, '--format', 'text',
      ]);
      const textReport = String(output.mock.calls[1]?.[0]);
      expect(textReport).toContain('Evaluated repo: acme/demo');
      expect(textReport).toContain('Collection note: limited to 50 recent pull requests; more are available');
      expect(textReport).toContain('#10');
      expect(textReport).not.toContain('cli-test-secret');
    } finally {
      output.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('runs GitHub mode without credentials when the token environment variable is unset', async () => {
    const history: GitHubRepositoryHistory = {
      owner: 'acme', repository: 'public-demo', requestedLimit: 50,
      pullRequests: [], pullRequestListComplete: true, pullRequestListHasMore: false,
      pullRequestListIncompleteReason: null,
    };
    const fetchHistory = vi.fn(async () => history);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('GITHUB_TOKEN', undefined);
    try {
      await createProgram(fetchHistory).parseAsync([
        'node', 'caver-ci', 'analyze', '--repo', 'acme/public-demo', '--platform', 'github.com',
        '--base', workflow, '--proposed', workflow,
      ]);
      expect(fetchHistory).toHaveBeenCalledWith('acme/public-demo', 50, { token: undefined });
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ repository: 'acme/public-demo', pullRequestCount: 0 });
      expect(String(output.mock.calls[0]?.[0])).not.toContain('cli-test-secret');
    } finally {
      output.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('rejects API limits above 100 before contacting GitHub', async () => {
    const fetchHistory = vi.fn();
    const program = createProgram(fetchHistory).exitOverride();
    program.commands.find(command => command.name() === 'analyze')?.exitOverride();
    await expect(program.parseAsync([
      'node', 'caver-ci', 'analyze', '--repo', 'acme/demo', '--limit', '101', '--platform', 'github.com',
      '--base', workflow, '--proposed', workflow,
    ])).rejects.toThrow('limit must be between 1 and 100');
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it('shows command help and rejects unknown output formats clearly', async () => {
    const program = createProgram();
    expect(program.commands.find(command => command.name() === 'analyze')?.helpInformation()).toContain('--format <format>');
    const invalid = createProgram().exitOverride();
    invalid.commands.find(command => command.name() === 'analyze')?.exitOverride();
    await expect(invalid.parseAsync([
      'node', 'caver-ci', 'analyze', '--platform', 'github.com', '--base', workflow, '--proposed', workflow,
      '--prs', prs, '--format', 'yaml',
    ])).rejects.toThrow('format must be json or text');
  });

  it('prints the package version through both version entry points', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    for (const args of [['--version'], ['-v'], ['version']]) {
      const output = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
      expect(output.status).toBe(0);
      expect(output.stdout.trim()).toBe(packageJson.version);
    }
  });

  it('rejects ambiguous input modes and never fetches unsupported platforms', async () => {
    const fetchHistory = vi.fn();
    const program = createProgram(fetchHistory).exitOverride();
    await expect(program.parseAsync([
      'node', 'caver-ci', 'analyze', '--repo', 'acme/demo', '--prs', prs, '--platform', 'github.com',
      '--base', workflow, '--proposed', workflow,
    ])).rejects.toThrow('Choose exactly one input mode');
    await expect(program.parseAsync([
      'node', 'caver-ci', 'analyze', '--repo', 'acme/demo', '--platform', 'ghes',
      '--base', workflow, '--proposed', workflow,
    ])).rejects.toThrow('supports only --platform github.com');
    expect(fetchHistory).not.toHaveBeenCalled();
  });
});
