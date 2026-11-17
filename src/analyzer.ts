import type { PullRequestFixture } from './fixtures.js';
import { matchesPatterns } from './patterns.js';
import { parseWorkflow } from './workflow.js';

export { parseFixtures } from './fixtures.js';
export type { PullRequestFixture } from './fixtures.js';

export type Decision = 'run' | 'skip' | 'unknown';
export interface Result { decision: Decision; reason: string }

const SUPPORTED_PLATFORM = 'github.com';
const DEFAULT_PULL_REQUEST_TYPES = ['opened', 'synchronize', 'reopened'];
const KNOWN_PULL_REQUEST_ACTIONS = new Set([
  'opened', 'edited', 'closed', 'reopened', 'synchronize', 'assigned', 'unassigned',
  'labeled', 'unlabeled', 'locked', 'unlocked', 'ready_for_review', 'review_requested',
  'review_request_removed', 'converted_to_draft', 'auto_merge_enabled',
  'auto_merge_disabled', 'enqueued', 'dequeued', 'milestoned', 'demilestoned',
]);

const result = (decision: Decision, reason: string): Result => ({ decision, reason });

export function analyzeWorkflow(source: string, pr: PullRequestFixture, platform: string): Result {
  if (platform !== SUPPORTED_PLATFORM) {
    return result('unknown', 'Unsupported or unspecified platform; only github.com is supported');
  }

  const parsed = parseWorkflow(source);
  if (parsed.kind !== 'trigger') return result(parsed.kind, parsed.reason);
  const { config } = parsed;

  if (!KNOWN_PULL_REQUEST_ACTIONS.has(pr.action)) {
    return result('unknown', 'Unsupported pull request action');
  }
  const types = config.types ?? DEFAULT_PULL_REQUEST_TYPES;
  if (types.some(type => !KNOWN_PULL_REQUEST_ACTIONS.has(type))) {
    return result('unknown', 'Unsupported pull request activity type');
  }
  if (!types.includes(pr.action)) return result('skip', 'Pull request activity does not match');

  if (config.branches) {
    if (pr.baseBranch === null) return result('unknown', 'Base branch metadata is unavailable');
    if (!matchesPatterns(pr.baseBranch, config.branches)) {
      return result('skip', 'Base branch does not match');
    }
  }
  if (config['branches-ignore']) {
    if (pr.baseBranch === null) return result('unknown', 'Base branch metadata is unavailable');
    if (matchesPatterns(pr.baseBranch, config['branches-ignore'])) {
      return result('skip', 'Base branch is ignored');
    }
  }

  if (config.paths || config['paths-ignore']) {
    if (!pr.filesComplete) return result('unknown', 'Changed file list is incomplete');
    if (pr.changedFiles.length > 3000) {
      return result('unknown', 'Changed file list exceeds GitHub diff limit');
    }
    if (pr.changedFiles.length === 0) return result('skip', 'No changed files');
    const pathPatterns = config.paths;
    if (pathPatterns && !pr.changedFiles.some(file => matchesPatterns(file, pathPatterns))) {
      return result('skip', 'No changed file matches paths');
    }
    const ignoredPathPatterns = config['paths-ignore'];
    if (ignoredPathPatterns && pr.changedFiles.every(file => matchesPatterns(file, ignoredPathPatterns))) {
      return result('skip', 'All changed files are ignored');
    }
  }

  return result('run', 'Pull request trigger filters match');
}
