import { describe, expect, it } from 'vitest';
import { analyzeWorkflow, parseFixtures, type PullRequestFixture } from '../src/analyzer.js';

const pr: PullRequestFixture = { id: '1', baseBranch: 'main', action: 'opened', changedFiles: ['src/app.ts'], filesComplete: true };
const check = (yaml: string, override: Partial<PullRequestFixture> = {}) => analyzeWorkflow(yaml, { ...pr, ...override }, 'github.com').decision;

describe('workflow trigger eligibility', () => {
  it('supports string, list and mapping event forms', () => {
    expect(check('on: pull_request')).toBe('run');
    expect(check('on: [push, pull_request]')).toBe('run');
    expect(check('on:\n  pull_request:')).toBe('run');
    expect(check('on: push')).toBe('skip');
  });
  it('applies ordered exclusions and re-inclusions per file', () => {
    const yaml = "on:\n  pull_request:\n    paths: ['src/**', '!src/generated/**', 'src/generated/keep/**']";
    expect(check(yaml, { changedFiles: ['src/generated/a.ts'] })).toBe('skip');
    expect(check(yaml, { changedFiles: ['src/generated/keep/a.ts'] })).toBe('run');
    expect(check(yaml, { changedFiles: ['src/generated/a.ts', 'src/app.ts'] })).toBe('run');
  });
  it('combines branch and path filters and supports ignore filters', () => {
    const yaml = "on:\n  pull_request:\n    branches: ['release/**', '!release/old/**']\n    paths-ignore: ['docs/**']";
    expect(check(yaml, { baseBranch: 'release/v1' })).toBe('run');
    expect(check(yaml, { baseBranch: 'release/old/v1' })).toBe('skip');
    expect(check(yaml, { baseBranch: 'release/v1', changedFiles: ['docs/a.md'] })).toBe('skip');
    expect(check("on:\n  pull_request:\n    branches-ignore: [main]")).toBe('skip');
  });
  it('honors explicit and default activity types', () => {
    expect(check('on: pull_request', { action: 'closed' })).toBe('skip');
    expect(check('on:\n  pull_request:\n    types: [closed]', { action: 'closed' })).toBe('run');
    expect(check('on: pull_request', { action: 'future_action' })).toBe('unknown');
  });
  it('applies ordered exclusions and re-inclusions to branch filters', () => {
    const yaml = "on:\n  pull_request:\n    branches: ['release/**', '!release/old/**', 'release/old/keep/**']";
    expect(check(yaml, { baseBranch: 'release/v1' })).toBe('run');
    expect(check(yaml, { baseBranch: 'release/old/v1' })).toBe('skip');
    expect(check(yaml, { baseBranch: 'release/old/keep/v1' })).toBe('run');
  });
  it('returns unknown for pipe alternation in branch patterns', () => {
    const yaml = "on:\n  pull_request:\n    branches: ['release/main|dev']";
    expect(check(yaml, { baseBranch: 'dev' })).toBe('unknown');
  });
  it('does not guess unsupported, malformed or incomplete input', () => {
    expect(check('on: [')).toBe('unknown');
    expect(check('name: CI')).toBe('unknown');
    expect(check('on:\n  pull_request:\n    paths: ["src/[ab]/**"]')).toBe('unknown');
    expect(check('on:\n  pull_request:\n    paths: ["!docs/**"]')).toBe('unknown');
    expect(check('on:\n  pull_request:\n    paths: ["src/**"]\n    paths-ignore: ["docs/**"]')).toBe('unknown');
    expect(check('on:\n  pull_request:\n    mystery: true')).toBe('unknown');
    expect(check('on:\n  pull_request:\n    paths: ["src/**"]', { filesComplete: false })).toBe('unknown');
    expect(check('on: pull_request', { filesComplete: false })).toBe('run');
  });
  it('rejects malformed fixtures and duplicate ids', () => {
    expect(() => parseFixtures([{}])).toThrow();
    expect(() => parseFixtures([pr, pr])).toThrow();
    expect(parseFixtures([pr])).toEqual([pr]);
    expect(parseFixtures([])).toEqual([]);
  });
  it('identifies the fixture field and index for invalid records', () => {
    expect(() => parseFixtures([{ ...pr, baseBranch: '' }])).toThrow(/index 0.*non-empty baseBranch/i);
    expect(() => parseFixtures([{ ...pr, changedFiles: [''] }])).toThrow(/index 0.*changedFiles to be an array/i);
    expect(() => parseFixtures([{ ...pr, filesComplete: 'yes' }])).toThrow(/index 0.*filesComplete to be a boolean/i);
    expect(() => parseFixtures([pr, { ...pr, action: '' }])).toThrow(/index 1.*non-empty action/i);
  });
});

describe('audit regressions', () => {
  it.each([
    ['src/generated/a.ts', ['src/**', '!src/generated/**'], 'skip'],
    ['src/generated/a.ts', ['!src/generated/**', 'src/**'], 'run'],
    ['src/generated/keep/a.ts', ['src/**', '!src/generated/**', 'src/generated/keep/**'], 'run'],
    ['src/generated/keep/a.ts', ['src/**', 'src/generated/keep/**', '!src/generated/**'], 'skip'],
    ['src/.private/a.ts', ['src/**'], 'run'],
    ['src/a.ts', ['src/*'], 'run'],
    ['src/sub/a.ts', ['src/*'], 'skip'],
  ])('evaluates %s with ordered patterns', (file, patterns, expected) => {
    const yaml = `on:\n  pull_request:\n    paths: ${JSON.stringify(patterns)}`;
    expect(check(yaml, { changedFiles: [file] })).toBe(expected);
  });
  it('requires both branch and path matches', () => {
    const yaml = "on:\n  pull_request:\n    branches: [main]\n    paths: ['src/**']";
    expect(check(yaml)).toBe('run');
    expect(check(yaml, { baseBranch: 'dev' })).toBe('skip');
    expect(check(yaml, { changedFiles: ['docs/a.md'] })).toBe('skip');
    expect(check(yaml, { baseBranch: 'dev', filesComplete: false })).toBe('skip');
    expect(check(yaml, { filesComplete: false })).toBe('unknown');
  });
  it('handles paths-ignore with mixed and empty lists', () => {
    const yaml = "on:\n  pull_request:\n    paths-ignore: ['docs/**']";
    expect(check(yaml, { changedFiles: ['docs/a.md', 'src/a.ts'] })).toBe('run');
    expect(check(yaml, { changedFiles: ['docs/a.md'] })).toBe('skip');
    expect(check(yaml, { changedFiles: [] })).toBe('skip');
    expect(check(yaml, { changedFiles: [], filesComplete: false })).toBe('unknown');
  });
  it.each(['opened', 'synchronize', 'reopened'])('includes default action %s', action => {
    expect(check('on: pull_request', { action })).toBe('run');
  });
  it.each(['closed', 'edited', 'milestoned', 'demilestoned'])('excludes non-default action %s', action => {
    expect(check('on: pull_request', { action })).toBe('skip');
    expect(check(`on:\n  pull_request:\n    types: [${action}]`, { action })).toBe('run');
  });
  it('keeps unquoted and quoted on as a YAML key', () => {
    expect(check('on: pull_request')).toBe('run');
    expect(check('"on": pull_request')).toBe('run');
    expect(check("'on': pull_request")).toBe('run');
    expect(check('on: push\non: pull_request')).toBe('unknown');
    expect(check('on: [pull_request, 2]')).toBe('unknown');
    expect(check('on:\n  pull_request: false')).toBe('unknown');
  });
  it.each(['src/?.ts', 'src/[ab].ts', 'src/{a,b}.ts', 'src/+(a).ts', 'src/foo**bar', 'release/main|dev', '!docs/**'])('rejects unsupported pattern %s', pattern => {
    expect(check(`on:\n  pull_request:\n    paths: ${JSON.stringify([pattern])}`)).toBe('unknown');
  });
  it('treats unknown types, conflicting filters, and aliases as unknown', () => {
    expect(check('on:\n  pull_request:\n    types: [new_action]')).toBe('unknown');
    expect(check('on:\n  pull_request:\n    branches: [main]\n    branches-ignore: [dev]')).toBe('unknown');
    expect(check('events: &events [pull_request]\non: *events')).toBe('unknown');
    expect(check('on:\n  pull_request:\n    paths: []')).toBe('unknown');
  });
  it('does not infer GitHub diff ordering above 3,000 files', () => {
    const changedFiles = Array.from({ length: 3001 }, (_, i) => `src/${i}.ts`);
    expect(check("on:\n  pull_request:\n    paths: ['src/**']", { changedFiles })).toBe('unknown');
    expect(check('on: pull_request', { changedFiles })).toBe('run');
  });
  it('rejects absolute, traversal, and empty path patterns conservatively', () => {
    for (const pattern of ['/src/**', 'src/../secrets/**', 'src//app.ts', '']) {
      const yaml = `on:\n  pull_request:\n    paths: ${JSON.stringify([pattern])}`;
      expect(check(yaml)).toBe('unknown');
    }
  });
  it.each([null, {}, [null], [{ ...pr, id: '' }], [{ ...pr, changedFiles: [3] }], [{ ...pr, filesComplete: 'yes' }]])('rejects invalid fixture input', input => {
    expect(() => parseFixtures(input)).toThrow();
  });
});
