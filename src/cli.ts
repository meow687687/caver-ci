#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { analyzeWorkflow } from './analyzer.js';
import { parseFixtures } from './fixtures.js';
import {
  collectGitHubRepositoryHistory,
  DEFAULT_GITHUB_PULL_REQUEST_LIMIT,
  MAX_GITHUB_PULL_REQUEST_LIMIT,
  type GitHubRepositoryHistory,
} from './github.js';

const CLI_VERSION = '0.3.0-alpha.0';
type HistoryFetcher = typeof collectGitHubRepositoryHistory;
type OutputFormat = 'json' | 'text';

function parseLimit(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError('limit must be a positive integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_GITHUB_PULL_REQUEST_LIMIT) {
    throw new InvalidArgumentError(`limit must be between 1 and ${MAX_GITHUB_PULL_REQUEST_LIMIT}`);
  }
  return parsed;
}

function compareWorkflows(base: string, proposed: string, platform: string, fixtures: ReturnType<typeof parseFixtures>) {
  return fixtures.map(pr => {
    const before = analyzeWorkflow(base, pr, platform);
    const after = analyzeWorkflow(proposed, pr, platform);
    const change = before.decision === 'unknown' || after.decision === 'unknown'
      ? 'unknown'
      : before.decision === after.decision
        ? 'unchanged'
        : `${before.decision} -> ${after.decision}`;
    return { id: pr.id, before, after, change };
  });
}

function parseFormat(value: string): OutputFormat {
  if (value === 'json' || value === 'text') return value;
  throw new InvalidArgumentError('format must be json or text');
}

type Comparison = {
  id: string;
  before: { decision: 'run' | 'skip' | 'unknown'; reason: string };
  after: { decision: 'run' | 'skip' | 'unknown'; reason: string };
  change: string;
};

function summary(comparisons: Comparison[]) {
  return comparisons.reduce((counts, comparison) => {
    if (comparison.before.decision === 'unknown' || comparison.after.decision === 'unknown') counts.unknown += 1;
    else if (comparison.before.decision === 'run' && comparison.after.decision === 'skip') counts.newlySkipped += 1;
    else if (comparison.before.decision === 'skip' && comparison.after.decision === 'run') counts.newlyTriggered += 1;
    else counts.unchanged += 1;
    return counts;
  }, { newlySkipped: 0, newlyTriggered: 0, unchanged: 0, unknown: 0 });
}

function renderTerminalReport(
  repository: string,
  platform: string,
  comparisons: Comparison[],
  listNote?: string | null,
): string {
  const counts = summary(comparisons);
  const lines = [
    'caver-ci · workflow trigger comparison',
    `Evaluated repo: ${repository}`,
    `Platform: ${platform}`,
    `Sample size: ${comparisons.length}`,
    `Newly skipped: ${counts.newlySkipped} · Newly triggered: ${counts.newlyTriggered} · Unchanged: ${counts.unchanged} · Unknown: ${counts.unknown}`,
  ];
  if (listNote) lines.push(`Collection note: ${listNote}`);
  if (comparisons.length === 0) {
    lines.push('', 'No pull requests were available in this sample.');
    return lines.join('\n');
  }
  lines.push('', 'Results:');
  for (const comparison of comparisons) {
    const label = comparison.before.decision === 'unknown' || comparison.after.decision === 'unknown'
      ? 'unknown'
      : comparison.before.decision === 'run' && comparison.after.decision === 'skip'
        ? 'newly skipped'
        : comparison.before.decision === 'skip' && comparison.after.decision === 'run'
          ? 'newly triggered'
          : 'unchanged';
    const reasons = comparison.before.decision === 'unknown' || comparison.after.decision === 'unknown'
      ? [comparison.before, comparison.after].filter(result => result.decision === 'unknown').map(result => result.reason)
      : [comparison.after.reason];
    lines.push(`  #${comparison.id}  ${comparison.before.decision} → ${comparison.after.decision}  (${label}) — ${[...new Set(reasons)].join('; ')}`);
  }
  lines.push('', 'These are trigger-filter evaluations for the supplied inputs; they do not report observed workflow executions or guarantee CI savings.');
  return lines.join('\n');
}

export function createGitHubReport(
  base: string,
  proposed: string,
  platform: string,
  history: GitHubRepositoryHistory,
) {
  const comparisons = history.pullRequests.map(pr => {
    const before = analyzeWorkflow(base, pr.fixture, platform);
    const after = analyzeWorkflow(proposed, pr.fixture, platform);
    const change = before.decision === 'unknown' || after.decision === 'unknown'
      ? 'unknown'
      : before.decision === after.decision
        ? 'unchanged'
        : `${before.decision} -> ${after.decision}`;
    return {
      id: pr.id,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      baseBranch: pr.baseBranch,
      hypotheticalAction: pr.hypotheticalAction,
      changedFileCount: pr.changedFileCount,
      filesComplete: pr.filesComplete,
      filesIncompleteReason: pr.filesIncompleteReason,
      before,
      after,
      change,
    };
  });

  return {
    platform,
    supportedPlatform: 'github.com',
    mode: 'github-rest',
    interpretation: 'Hypothetical evaluation of the supplied workflow configurations against historical pull request file changes. This does not reconstruct historical workflow configuration or execution.',
    repository: `${history.owner}/${history.repository}`,
    eventScenario: {
      event: 'pull_request',
      action: 'opened',
      actionIsHypothetical: true,
      note: 'GitHub REST pull request records do not identify the historical event action; opened is used as the explicit evaluation scenario.',
    },
    requestedLimit: history.requestedLimit,
    pullRequestCount: history.pullRequests.length,
    pullRequestListComplete: history.pullRequestListComplete,
    pullRequestListHasMore: history.pullRequestListHasMore,
    pullRequestListIncompleteReason: history.pullRequestListIncompleteReason,
    comparisons,
  };
}

export function createProgram(fetchHistory: HistoryFetcher = collectGitHubRepositoryHistory): Command {
  const program = new Command();
  program.name('caver-ci').description('Compare pull request trigger eligibility on GitHub.com').version(CLI_VERSION);
  program.command('analyze')
    .description('Compare workflow pull_request trigger filters against fixtures or recent public GitHub PRs')
    .requiredOption('--platform <platform>', 'target platform (only github.com is supported)')
    .requiredOption('--base <file>', 'original workflow YAML file')
    .requiredOption('--proposed <file>', 'proposed workflow YAML file')
    .option('--prs <file>', 'pull request fixture JSON (offline mode)')
    .option('--repo <owner/repository>', 'public GitHub.com repository (GitHub REST mode)')
    .option('--limit <number>', `maximum recent pull requests in GitHub API mode (default ${DEFAULT_GITHUB_PULL_REQUEST_LIMIT}, max ${MAX_GITHUB_PULL_REQUEST_LIMIT})`, parseLimit, DEFAULT_GITHUB_PULL_REQUEST_LIMIT)
    .option('--format <format>', 'output format: json (default, script-compatible) or text', parseFormat, 'json')
    .addHelpText('after', '\nExamples:\n  caver-ci analyze --platform github.com --base before.yml --proposed after.yml --prs prs.json --format text\n  caver-ci analyze --platform github.com --base before.yml --proposed after.yml --repo owner/repository')
    .action(async (options: { base: string; proposed: string; prs?: string; repo?: string; limit: number; platform: string; format: OutputFormat }) => {
      if (Boolean(options.prs) === Boolean(options.repo)) {
        throw new Error('Choose exactly one input mode: --prs <file> or --repo <owner/repository>');
      }
      const readInput = async (file: string, label: string) => {
        try { return await readFile(file, 'utf8'); }
        catch { throw new Error(`Cannot read ${label} file: ${file}`); }
      };
      const [base, proposed] = await Promise.all([
        readInput(options.base, 'base workflow'),
        readInput(options.proposed, 'proposed workflow'),
      ]);

      if (options.prs) {
        const fixtureContent = await readInput(options.prs, 'PR fixture');
        let parsedFixtures: unknown;
        try { parsedFixtures = JSON.parse(fixtureContent) as unknown; }
        catch { throw new Error(`PR fixture file is not valid JSON: ${options.prs}`); }
        const fixtures = parseFixtures(parsedFixtures);
        const comparisons = compareWorkflows(base, proposed, options.platform, fixtures);
        // Keep this fixture-mode JSON contract unchanged for existing scripts.
        const report = {
          platform: options.platform,
          supportedPlatform: 'github.com',
          comparisons,
        };
        console.log(options.format === 'json'
          ? JSON.stringify(report, null, 2)
          : renderTerminalReport('offline fixtures (repository not specified)', options.platform, comparisons));
        return;
      }

      if (options.platform !== 'github.com') {
        throw new Error('GitHub API mode supports only --platform github.com');
      }
      const history = await fetchHistory(options.repo!, options.limit, {
        token: process.env.GITHUB_TOKEN,
      });
      const report = createGitHubReport(base, proposed, options.platform, history);
      console.log(options.format === 'json'
        ? JSON.stringify(report, null, 2)
        : renderTerminalReport(report.repository, report.platform, report.comparisons, report.pullRequestListIncompleteReason ??
          (report.pullRequestListHasMore ? `limited to ${report.requestedLimit} recent pull requests; more are available` : null)));
    });
  return program;
}

async function main(): Promise<void> {
  await createProgram().parseAsync(process.argv);
}

const entryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => process.argv[1]) : undefined;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
