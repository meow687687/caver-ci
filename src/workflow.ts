import { parseDocument } from 'yaml';
import { validPatterns } from './patterns.js';

export interface PullRequestConfig {
  types?: string[];
  branches?: string[];
  'branches-ignore'?: string[];
  paths?: string[];
  'paths-ignore'?: string[];
}

export type WorkflowParseResult =
  | { kind: 'trigger'; config: PullRequestConfig }
  | { kind: 'skip'; reason: string }
  | { kind: 'unknown'; reason: string };

const unknown = (reason: string): WorkflowParseResult => ({ kind: 'unknown', reason });
const skip = (reason: string): WorkflowParseResult => ({ kind: 'skip', reason });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.length > 0);

export function parseWorkflow(source: string): WorkflowParseResult {
  let document;
  try {
    document = parseDocument(source, { uniqueKeys: true });
  } catch {
    return unknown('Invalid workflow YAML');
  }
  if (document.errors.length > 0) return unknown('Invalid workflow YAML');

  let workflow: unknown;
  try {
    workflow = document.toJS({ maxAliasCount: 0 });
  } catch {
    return unknown('Unsupported YAML aliases');
  }
  if (!isRecord(workflow) || !Object.hasOwn(workflow, 'on')) {
    return unknown('Missing or invalid workflow trigger');
  }

  const trigger = workflow.on;
  let rawConfig: unknown;
  if (typeof trigger === 'string') {
    if (trigger !== 'pull_request') return skip('No pull_request trigger');
    rawConfig = null;
  } else if (Array.isArray(trigger)) {
    if (!trigger.every(item => typeof item === 'string')) return unknown('Invalid event list');
    if (!trigger.includes('pull_request')) return skip('No pull_request trigger');
    rawConfig = null;
  } else if (isRecord(trigger)) {
    if (!Object.hasOwn(trigger, 'pull_request')) return skip('No pull_request trigger');
    rawConfig = trigger.pull_request;
  } else {
    return unknown('Invalid workflow trigger');
  }

  if (rawConfig == null) rawConfig = {};
  if (!isRecord(rawConfig)) return unknown('Invalid pull_request configuration');

  const allowed = new Set(['types', 'branches', 'branches-ignore', 'paths', 'paths-ignore']);
  if (Object.keys(rawConfig).some(key => !allowed.has(key))) {
    return unknown('Unsupported pull_request configuration');
  }
  if (('branches' in rawConfig && 'branches-ignore' in rawConfig) ||
      ('paths' in rawConfig && 'paths-ignore' in rawConfig)) {
    return unknown('Conflicting filters');
  }

  for (const key of ['types', 'branches', 'branches-ignore', 'paths', 'paths-ignore']) {
    if (key in rawConfig && !strings(rawConfig[key])) return unknown(`Invalid ${key} filter`);
  }
  for (const key of ['branches', 'branches-ignore', 'paths', 'paths-ignore'] as const) {
    const patterns = rawConfig[key];
    if (strings(patterns) && !validPatterns(patterns, !key.endsWith('-ignore'))) {
      return unknown(`Unsupported ${key} pattern`);
    }
  }

  return {
    kind: 'trigger',
    config: {
      types: rawConfig.types as string[] | undefined,
      branches: rawConfig.branches as string[] | undefined,
      'branches-ignore': rawConfig['branches-ignore'] as string[] | undefined,
      paths: rawConfig.paths as string[] | undefined,
      'paths-ignore': rawConfig['paths-ignore'] as string[] | undefined,
    },
  };
}
