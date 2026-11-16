import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeWorkflow, parseFixtures, type Decision, type PullRequestFixture } from '../src/analyzer.js';

type RealCase = { id: string; workflow: string; pr: PullRequestFixture; expected: Decision; classification: string };
type IndependentCase = { id: string; patterns: string[]; branch: string; files: string[]; complete: boolean; expected: Decision };
const load = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const real = load<RealCase[]>('validation/real-cases.json');
const independent = load<IndependentCase[]>('validation/independent-cases.json');

describe('independent trigger fixtures', () => {
  it.each(independent)('$id', c => {
    const yaml = `on:\n  pull_request:\n    branches: [main]\n    paths: ${JSON.stringify(c.patterns)}`;
    expect(analyzeWorkflow(yaml, { id: c.id, baseBranch: c.branch, action: 'opened', changedFiles: c.files, filesComplete: c.complete }, 'github.com').decision).toBe(c.expected);
  });
  it('rejects missing required PR metadata instead of inventing it', () => {
    expect(() => parseFixtures([{ id: 'missing', changedFiles: [], filesComplete: false }])).toThrow();
  });
  it('never predicts for the known Enterprise Server discrepancy', () => {
    const yaml = "on:\n  pull_request:\n    paths: ['src/**']";
    const changedFiles = [...Array.from({ length: 300 }, (_, i) => `docs/${i}.md`), 'src/app.ts'];
    const pr = { id: 'enterprise', baseBranch: 'main', action: 'opened', changedFiles, filesComplete: true };
    expect(analyzeWorkflow(yaml, pr, 'ghes-3.19').decision).toBe('unknown');
    expect(analyzeWorkflow(yaml, pr, '').decision).toBe('unknown');
    expect(analyzeWorkflow(yaml, pr, 'github.com').decision).toBe('run');
  });

});

describe('pinned public workflow validation', () => {
  it.each(real)('$id', c => {
    const source = readFileSync(`validation/workflows/${c.workflow}`, 'utf8');
    const decision = analyzeWorkflow(source, c.pr, 'github.com').decision;
    if (c.classification === 'definite') expect(decision).toBe(c.expected);
    else expect(decision).toBe('unknown');
  });
});

describe('GitHub.com diff window', () => {
  const yaml = "on:\n  pull_request:\n    paths: ['src/**']";
  const base: PullRequestFixture = { id: 'boundary', baseBranch: 'main', action: 'opened', changedFiles: [], filesComplete: true };
  const files = (n: number, matchPosition?: number) => Array.from({ length: n }, (_, i) => i === matchPosition ? 'src/app.ts' : `docs/${i}.md`);
  it.each([300, 301, 3000])('evaluates every file in a complete %i-file GitHub.com diff', count => {
    for (const position of [0, count - 1]) {
      expect(analyzeWorkflow(yaml, { ...base, changedFiles: files(count, position) }, 'github.com').decision).toBe('run');
    }
    expect(analyzeWorkflow(yaml, { ...base, changedFiles: files(count) }, 'github.com').decision).toBe('skip');
    expect(analyzeWorkflow(yaml, { ...base, changedFiles: files(count, 0), filesComplete: false }, 'github.com').decision).toBe('unknown');
  });
  it('does not assume input order is GitHub order at 3001 files', () => {
    for (const position of [0, 2999, 3000, undefined]) {
      expect(analyzeWorkflow(yaml, { ...base, changedFiles: files(3001, position) }, 'github.com').decision).toBe('unknown');
      expect(analyzeWorkflow(yaml, { ...base, changedFiles: files(3001, position), filesComplete: false }, 'github.com').decision).toBe('unknown');
    }
  });
  it('handles ignored paths conservatively at the same boundary', () => {
    const ignored = "on:\n  pull_request:\n    paths-ignore: ['docs/**']";
    expect(analyzeWorkflow(ignored, { ...base, changedFiles: files(3000) }, 'github.com').decision).toBe('skip');
    expect(analyzeWorkflow(ignored, { ...base, changedFiles: files(3000, 2999) }, 'github.com').decision).toBe('run');
    expect(analyzeWorkflow(ignored, { ...base, changedFiles: files(3001, 3000) }, 'github.com').decision).toBe('unknown');
    expect(analyzeWorkflow(ignored, { ...base, changedFiles: files(3001) }, 'github.com').decision).toBe('unknown');
  });
  it('does not infer platform even if the trigger is absent', () => {
    expect(analyzeWorkflow('on: push', base, 'ghes-3.19').decision).toBe('unknown');
    expect(analyzeWorkflow('on: pull_request', base, undefined as unknown as string).decision).toBe('unknown');
  });
});
