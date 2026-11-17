import { Octokit } from '@octokit/rest';
import type { PullRequestFixture } from './fixtures.js';

export const GITHUB_DIFF_FILE_LIMIT = 3000;
export const MAX_GITHUB_PULL_REQUEST_LIMIT = 100;
export const DEFAULT_GITHUB_PULL_REQUEST_LIMIT = 50;
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
export const GITHUB_MAX_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 5_000;

export interface ChangedFileMetadata {
  filename: string;
  status: string | null;
  previousFilename: string | null;
}

export interface HistoricalPullRequest {
  number: number | null;
  id: string;
  title: string | null;
  url: string | null;
  state: string | null;
  draft: boolean | null;
  merged: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
  baseBranch: string | null;
  hypotheticalAction: 'opened';
  fixture: PullRequestFixture;
  changedFileCount: number;
  changedFiles: ChangedFileMetadata[];
  filesComplete: boolean;
  filesIncompleteReason: string | null;
}

export interface GitHubRepositoryHistory {
  owner: string;
  repository: string;
  pullRequests: HistoricalPullRequest[];
  requestedLimit: number;
  pullRequestListComplete: boolean;
  pullRequestListHasMore: boolean;
  pullRequestListIncompleteReason: string | null;
}

export interface GitHubClientOptions {
  token?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

type LinkResponse = { headers: Record<string, string | number | undefined> };
type GitHubRequest = () => Promise<LinkResponse & { data: unknown }>;
type RetryContext = { sleep: (milliseconds: number) => Promise<void>; timeoutMs: number };

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryCount = 0,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseRepositorySlug(value: string): { owner: string; repository: string } {
  const parts = value.split('/');
  const validPart = (part: string) => /^[A-Za-z0-9_.-]{1,100}$/.test(part) && part !== '.' && part !== '..';
  if (parts.length !== 2 || !validPart(parts[0]!) || !validPart(parts[1]!)) {
    throw new Error('Repository must be written as owner/repository');
  }
  return { owner: parts[0]!, repository: parts[1]! };
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error) || typeof error.status !== 'number') return null;
  return error.status;
}

function errorHeaders(error: unknown): Record<string, string | number | undefined> {
  if (!isRecord(error) || !isRecord(error.response) || !isRecord(error.response.headers)) return {};
  return error.response.headers as Record<string, string | number | undefined>;
}

function errorMessage(error: unknown): string {
  if (!isRecord(error) || typeof error.message !== 'string') return '';
  return error.message.toLowerCase();
}

function header(headers: Record<string, string | number | undefined>, key: string): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()];
  return value === undefined ? undefined : String(value);
}

function rateLimited(status: number | null, headers: Record<string, string | number | undefined>, message: string): boolean {
  return status === 429 || (
    status === 403 && (
      header(headers, 'x-ratelimit-remaining') === '0' ||
      header(headers, 'retry-after') !== undefined ||
      /rate limit|secondary rate|abuse detection/.test(message)
    )
  );
}

function rateLimitWait(headers: Record<string, string | number | undefined>): number | null {
  const retryAfter = Number(header(headers, 'retry-after'));
  let requestedWait: number;
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    requestedWait = retryAfter * 1000;
  } else {
    const resetAt = Number(header(headers, 'x-ratelimit-reset'));
    requestedWait = Number.isFinite(resetAt) ? Math.max(0, resetAt * 1000 - Date.now()) : 1000;
  }
  return requestedWait <= MAX_RATE_LIMIT_WAIT_MS ? requestedWait : null;
}

function isTimeout(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const name = typeof error.name === 'string' ? error.name : '';
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const cause = isRecord(error.cause) ? error.cause : null;
  const causeName = typeof cause?.name === 'string' ? cause.name : '';
  const causeMessage = typeof cause?.message === 'string' ? cause.message.toLowerCase() : '';
  return name === 'AbortError' || name === 'TimeoutError' || code === 'ETIMEDOUT' ||
    message.includes('timed out') || message.includes('timeout') ||
    causeName === 'AbortError' || causeName === 'TimeoutError' ||
    causeMessage.includes('timed out') || causeMessage.includes('timeout');
}

const withRequestTimeout = (timeoutMs: number) => ({
  request: { signal: AbortSignal.timeout(timeoutMs) },
});

function describeApiFailure(status: number | null, limited: boolean, timedOut: boolean, timeoutMs: number): string {
  if (status === 401) return 'GitHub returned 401 Unauthorized; check that GITHUB_TOKEN is valid';
  if (limited) return 'GitHub rate limit reached; retry later or provide a GITHUB_TOKEN';
  if (status === 403) return 'GitHub returned 403 Forbidden; confirm the repository is public and readable';
  if (status === 404) return 'GitHub returned 404 Not Found; confirm the public repository and pull request exist';
  if (timedOut) return `GitHub request timed out after ${timeoutMs} ms`;
  if (status !== null) return `GitHub request failed with HTTP ${status}`;
  return 'GitHub request failed due to a network error';
}

async function requestWithRetry<T>(
  request: GitHubRequest,
  context: RetryContext,
): Promise<{ data: T; headers: Record<string, string | number | undefined> }> {
  let retryCount = 0;
  for (;;) {
    try {
      const response = await request();
      return response as { data: T; headers: Record<string, string | number | undefined> };
    } catch (error) {
      const status = errorStatus(error);
      const headers = errorHeaders(error);
      const message = errorMessage(error);
      const limited = rateLimited(status, headers, message);
      const timedOut = isTimeout(error);
      const retryable = limited || status === null || status >= 500 || timedOut;
      if (!retryable || retryCount >= GITHUB_MAX_RETRIES) {
        throw new GitHubApiError(describeApiFailure(status, limited, timedOut, context.timeoutMs), status, retryCount);
      }

      const delay = limited ? rateLimitWait(headers) : Math.min(250 * (2 ** retryCount), 1000);
      if (delay === null) {
        throw new GitHubApiError(describeApiFailure(status, limited, timedOut, context.timeoutMs), status, retryCount);
      }
      await context.sleep(delay);
      retryCount += 1;
    }
  }
}

function hasNextPage(link: string | number | undefined): boolean {
  if (typeof link !== 'string') return false;
  return [...link.matchAll(/<[^>]+>\s*;\s*rel="?([^";,]+)"?/g)].some(match => match[1] === 'next');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeFile(value: unknown): { metadata: ChangedFileMetadata | null; paths: string[]; error: string | null } {
  if (!isRecord(value)) return { metadata: null, paths: [], error: 'GitHub returned an invalid changed-file record' };
  const filename = stringOrNull(value.filename);
  const status = stringOrNull(value.status);
  const previousFilename = stringOrNull(value.previous_filename);
  if (!filename) return { metadata: null, paths: [], error: 'A changed-file path was missing from GitHub metadata' };

  const metadata = { filename, status, previousFilename };
  if (status === 'renamed') {
    if (!previousFilename) return { metadata, paths: [filename], error: 'A renamed file was missing its previous filename' };
    return { metadata, paths: [filename, previousFilename], error: null };
  }
  if (status === 'added' || status === 'modified' || status === 'removed') {
    return { metadata, paths: [filename], error: null };
  }
  return { metadata, paths: [filename], error: 'A changed-file status was missing or unsupported' };
}

async function listChangedFiles(
  octokit: Octokit,
  owner: string,
  repository: string,
  pullNumber: number,
  context: RetryContext,
): Promise<{
  changedFiles: string[];
  metadata: ChangedFileMetadata[];
  count: number;
  complete: boolean;
  reason: string | null;
}> {
  const changedFiles: string[] = [];
  const metadata: ChangedFileMetadata[] = [];
  let observedCount = 0;
  let page = 1;
  let complete = true;
  let reason: string | null = null;

  while (page <= GITHUB_DIFF_FILE_LIMIT / 100) {
    let response;
    try {
      response = await requestWithRetry(
        () => octokit.rest.pulls.listFiles({
          owner, repo: repository, pull_number: pullNumber, per_page: 100, page,
          ...withRequestTimeout(context.timeoutMs),
        }),
        context,
      );
    } catch (error) {
      if (error instanceof GitHubApiError) {
        complete = false;
        reason = error.message;
        break;
      }
      throw error;
    }

    if (!Array.isArray(response.data)) {
      complete = false;
      reason = 'GitHub returned an invalid changed-file list';
      break;
    }

    observedCount += Math.min(response.data.length, GITHUB_DIFF_FILE_LIMIT - observedCount);
    for (const item of response.data.slice(0, GITHUB_DIFF_FILE_LIMIT - metadata.length)) {
      const normalized = normalizeFile(item);
      if (normalized.metadata) metadata.push(normalized.metadata);
      changedFiles.push(...normalized.paths);
      if (normalized.error && reason === null) reason = normalized.error;
    }

    const atFileLimit = metadata.length >= GITHUB_DIFF_FILE_LIMIT || response.data.length > GITHUB_DIFF_FILE_LIMIT - (page - 1) * 100;
    if (atFileLimit) {
      complete = false;
      reason = 'GitHub file listing reached its 3,000-file API limit; completeness is unknown';
      break;
    }

    if (!hasNextPage(response.headers.link)) break;
    if (page === GITHUB_DIFF_FILE_LIMIT / 100) {
      complete = false;
      reason = 'GitHub file listing exceeded its 3,000-file pagination boundary; completeness is unknown';
      break;
    }
    page += 1;
  }
  if (reason !== null) complete = false;
  return { changedFiles, metadata, count: observedCount, complete, reason };
}

export async function collectGitHubRepositoryHistory(
  slug: string,
  limit: number = DEFAULT_GITHUB_PULL_REQUEST_LIMIT,
  options: GitHubClientOptions = {},
): Promise<GitHubRepositoryHistory> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GITHUB_PULL_REQUEST_LIMIT) {
    throw new Error(`Limit must be an integer between 1 and ${MAX_GITHUB_PULL_REQUEST_LIMIT}`);
  }
  const { owner, repository } = parseRepositorySlug(slug);
  const timeoutMs = options.timeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS;
  const context: RetryContext = { sleep: options.sleep ?? wait, timeoutMs };
  const octokit = new Octokit({
    ...(options.token ? { auth: options.token } : {}),
    userAgent: 'caver-ci',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    request: {
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
  });

  const repositoryResponse = await requestWithRetry(
    () => octokit.rest.repos.get({ owner, repo: repository, ...withRequestTimeout(timeoutMs) }),
    context,
  );
  const repositoryRecord = isRecord(repositoryResponse.data) ? repositoryResponse.data : null;
  if (repositoryRecord?.private !== false || repositoryRecord.visibility !== 'public') {
    throw new GitHubApiError('Repository metadata does not confirm a public GitHub.com repository');
  }

  const pullRequests: Record<string, unknown>[] = [];
  let malformedPullRequestRecord = false;
  let listFailureReason: string | null = null;
  let page = 1;
  let listHasMore = false;
  while (pullRequests.length < limit) {
    const perPage = Math.min(limit, 100);
    let response;
    try {
      response = await requestWithRetry(
        () => octokit.rest.pulls.list({
          owner, repo: repository, state: 'all', sort: 'updated', direction: 'desc', per_page: perPage, page,
          ...withRequestTimeout(timeoutMs),
        }),
        context,
      );
    } catch (error) {
      if (pullRequests.length === 0) throw error;
      listFailureReason = error instanceof GitHubApiError ? error.message : 'GitHub pull request listing failed';
      break;
    }
    if (!Array.isArray(response.data)) {
      if (pullRequests.length === 0) throw new GitHubApiError('GitHub returned an invalid pull request list');
      listFailureReason = 'GitHub returned an invalid pull request list';
      break;
    }
    const pageData = response.data.filter(isRecord);
    if (pageData.length !== response.data.length) malformedPullRequestRecord = true;
    const remaining = limit - pullRequests.length;
    pullRequests.push(...pageData.slice(0, remaining));
    const nextPage = hasNextPage(response.headers.link);
    listHasMore = nextPage || pageData.length > remaining;
    if (!nextPage || pullRequests.length >= limit) break;
    page += 1;
  }

  const history: HistoricalPullRequest[] = [];
  for (const pull of pullRequests) {
    const number = typeof pull.number === 'number' && Number.isInteger(pull.number) && pull.number > 0 ? pull.number : null;
    if (number === null) {
      malformedPullRequestRecord = true;
      continue;
    }
    const base = isRecord(pull.base) ? pull.base : null;
    const baseBranch = stringOrNull(base?.ref);
    const details = await listChangedFiles(octokit, owner, repository, number, context);
    const id = String(number);
    const fixture: PullRequestFixture = {
      id,
      baseBranch,
      // The REST pull request resource does not report which historical event action fired.
      // Evaluate an explicit hypothetical opened event and disclose it in output.
      action: 'opened',
      changedFiles: details.changedFiles,
      filesComplete: details.complete,
    };
    history.push({
      number,
      id,
      title: stringOrNull(pull.title),
      url: stringOrNull(pull.html_url),
      state: stringOrNull(pull.state),
      draft: booleanOrNull(pull.draft),
      merged: booleanOrNull(pull.merged),
      createdAt: stringOrNull(pull.created_at),
      updatedAt: stringOrNull(pull.updated_at),
      baseBranch,
      hypotheticalAction: 'opened',
      fixture,
      changedFileCount: details.count,
      changedFiles: details.metadata,
      filesComplete: details.complete,
      filesIncompleteReason: details.reason,
    });
  }

  return {
    owner,
    repository,
    pullRequests: history,
    requestedLimit: limit,
    pullRequestListComplete: !listHasMore && !malformedPullRequestRecord && listFailureReason === null,
    pullRequestListHasMore: listHasMore,
    pullRequestListIncompleteReason: listFailureReason ?? (malformedPullRequestRecord
      ? 'GitHub returned pull request records without required metadata; those records were omitted'
      : null),
  };
}
