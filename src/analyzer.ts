import { parseDocument } from 'yaml';
import picomatch from 'picomatch';

export type Decision = 'run' | 'skip' | 'unknown';
export interface PullRequestFixture {
  id: string;
  baseBranch: string;
  action: string;
  changedFiles: string[];
  filesComplete: boolean;
}
export interface Result { decision: Decision; reason: string }
const result = (decision: Decision, reason: string): Result => ({ decision, reason });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x.length > 0);
const knownActions = new Set(['opened', 'edited', 'closed', 'reopened', 'synchronize', 'assigned', 'unassigned', 'labeled', 'unlabeled', 'locked', 'unlocked', 'ready_for_review', 'review_requested', 'review_request_removed', 'converted_to_draft', 'auto_merge_enabled', 'auto_merge_disabled', 'enqueued', 'dequeued', 'milestoned', 'demilestoned']);

export function parseFixtures(value: unknown): PullRequestFixture[] {
  if (!Array.isArray(value)) throw new Error('PR fixtures must be a JSON array');
  const ids = new Set<string>();
  return value.map((pr, index) => {
    if (!isRecord(pr) || typeof pr.id !== 'string' || !pr.id || typeof pr.baseBranch !== 'string' || !pr.baseBranch || typeof pr.action !== 'string' || !pr.action || !Array.isArray(pr.changedFiles) || !pr.changedFiles.every((p: unknown) => typeof p === 'string' && p.length > 0) || typeof pr.filesComplete !== 'boolean') {
      throw new Error(`Invalid PR fixture at index ${index}: expected id, baseBranch, action, changedFiles and filesComplete`);
    }
    if (ids.has(pr.id)) throw new Error(`Duplicate PR fixture id: ${pr.id}`);
    ids.add(pr.id);
    return pr as unknown as PullRequestFixture;
  });
}

// Only a deliberately small glob subset is accepted. Anything else is uncertain.
function validPatterns(patterns: string[], allowNegative: boolean): boolean {
  let positive = false;
  for (const raw of patterns) {
    const negative = raw.startsWith('!');
    const pattern = negative ? raw.slice(1) : raw;
    if ((negative && !allowNegative) || !pattern || /[\[\]{}()+?\\!]/.test(pattern) || pattern.split('/').some(segment => segment.includes('**') && segment !== '**') || pattern.startsWith('/') || pattern.includes('//') || /(^|\/)\.\.?($|\/)/.test(pattern)) return false;
    if (!negative) positive = true;
  }
  return positive;
}
function matches(value: string, patterns: string[]): boolean {
  let included = false;
  for (const raw of patterns) {
    const negative = raw.startsWith('!');
    const pattern = negative ? raw.slice(1) : raw;
    if (picomatch.isMatch(value, pattern, { dot: true, noext: true, nonegate: true })) included = !negative;
  }
  return included;
}

export function analyzeWorkflow(source: string, pr: PullRequestFixture): Result {
  let doc;
  try { doc = parseDocument(source, { uniqueKeys: true }); } catch { return result('unknown', 'Invalid workflow YAML'); }
  if (doc.errors.length) return result('unknown', 'Invalid workflow YAML');
  let workflow: unknown;
  try { workflow = doc.toJS({ maxAliasCount: 0 }); } catch { return result('unknown', 'Unsupported YAML aliases'); }
  if (!isRecord(workflow) || !Object.hasOwn(workflow, 'on')) return result('unknown', 'Missing or invalid workflow trigger');
  const on = workflow.on;
  let config: unknown;
  if (typeof on === 'string') {
    if (on !== 'pull_request') return result('skip', 'No pull_request trigger');
    config = null;
  } else if (Array.isArray(on)) {
    if (!on.every(x => typeof x === 'string')) return result('unknown', 'Invalid event list');
    if (!on.includes('pull_request')) return result('skip', 'No pull_request trigger');
    config = null;
  } else if (isRecord(on)) {
    if (!Object.hasOwn(on, 'pull_request')) return result('skip', 'No pull_request trigger');
    config = on.pull_request;
  } else return result('unknown', 'Invalid workflow trigger');
  if (config == null) config = {};
  if (!isRecord(config)) return result('unknown', 'Invalid pull_request configuration');
  const allowed = new Set(['types', 'branches', 'branches-ignore', 'paths', 'paths-ignore']);
  if (Object.keys(config).some(key => !allowed.has(key))) return result('unknown', 'Unsupported pull_request configuration');
  if (('branches' in config && 'branches-ignore' in config) || ('paths' in config && 'paths-ignore' in config)) return result('unknown', 'Conflicting filters');
  for (const key of ['types', 'branches', 'branches-ignore', 'paths', 'paths-ignore']) {
    if (key in config && !strings(config[key])) return result('unknown', `Invalid ${key} filter`);
  }
  for (const key of ['branches', 'branches-ignore', 'paths', 'paths-ignore']) {
    const patterns = config[key];
    if (strings(patterns) && !validPatterns(patterns, !key.endsWith('-ignore'))) return result('unknown', `Unsupported ${key} pattern`);
  }
  if (!knownActions.has(pr.action)) return result('unknown', 'Unsupported pull request action');
  const types = (config.types as string[] | undefined) ?? ['opened', 'synchronize', 'reopened'];
  if (types.some(type => !knownActions.has(type))) return result('unknown', 'Unsupported pull request activity type');
  if (!types.includes(pr.action)) return result('skip', 'Pull request activity does not match');
  if (strings(config.branches) && !matches(pr.baseBranch, config.branches)) return result('skip', 'Base branch does not match');
  if (strings(config['branches-ignore']) && matches(pr.baseBranch, config['branches-ignore'])) return result('skip', 'Base branch is ignored');
  if ('paths' in config || 'paths-ignore' in config) {
    if (!pr.filesComplete) return result('unknown', 'Changed file list is incomplete');
    if (pr.changedFiles.length > 3000) return result('unknown', 'Changed file list exceeds GitHub diff limit');
    if (pr.changedFiles.length === 0) return result('skip', 'No changed files');
    if (strings(config.paths) && !pr.changedFiles.some(file => matches(file, config.paths as string[]))) return result('skip', 'No changed file matches paths');
    if (strings(config['paths-ignore']) && pr.changedFiles.every(file => matches(file, config['paths-ignore'] as string[]))) return result('skip', 'All changed files are ignored');
  }
  return result('run', 'Pull request trigger filters match');
}
