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
    expect(analyzeWorkflow(yaml, { id: c.id, baseBranch: c.branch, action: 'opened', changedFiles: c.files, filesComplete: c.complete }).decision).toBe(c.expected);
  });
  it('rejects missing required PR metadata instead of inventing it', () => {
    expect(() => parseFixtures([{ id: 'missing', changedFiles: [], filesComplete: false }])).toThrow();
  });
  it('records the Enterprise Server 300-file discrepancy', () => {
    const yaml = "on:\n  pull_request:\n    paths: ['src/**']";
    const files = Array.from({ length: 300 }, (_, i) => `docs/${i}.md`);
    const pr = { id: 'limit', baseBranch: 'main', action: 'opened', changedFiles: files, filesComplete: true };
    expect(analyzeWorkflow(yaml, pr).decision).toBe('skip');
    expect(analyzeWorkflow(yaml, { ...pr, changedFiles: [...files.slice(0, 299), 'src/app.ts'] }).decision).toBe('run');
    // On Enterprise Server, a match only after the first 300 is skipped; v0.1 says run.
    expect(analyzeWorkflow(yaml, { ...pr, changedFiles: [...files, 'src/app.ts'] }).decision).toBe('run');
  });
});

describe('pinned public workflow validation', () => {
  it.each(real)('$id', c => {
    const source = readFileSync(`validation/workflows/${c.workflow}`, 'utf8');
    const decision = analyzeWorkflow(source, c.pr).decision;
    if (c.classification === 'definite') expect(decision).toBe(c.expected);
    else expect(decision).toBe('unknown');
  });
});
