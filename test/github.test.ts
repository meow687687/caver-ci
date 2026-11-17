import { describe, expect, it } from 'vitest';
import { collectGitHubRepositoryHistory, type GitHubClientOptions } from '../src/github.js';
import { createGitHubReport } from '../src/cli.js';

const nextLink = (path: string) => `<https://api.github.com${path}>; rel="next"`;
const apiResponse = (data: unknown, headers: Record<string, string> = {}, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'content-type': 'application/json', ...headers } },
);

function pull(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    html_url: `https://github.com/acme/demo/pull/${number}`,
    state: 'closed',
    draft: false,
    merged: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    base: { ref: 'main' },
    ...overrides,
  };
}

function fakeFetch(
  handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>,
  repositoryMetadata: unknown = { private: false, visibility: 'public' },
) {
  const calls: Array<{ url: URL; method: string; authorization: string | null }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', authorization: headers.get('authorization') });
    if (/^\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) return apiResponse(repositoryMetadata);
    return handler(url, init);
  };
  return { fetch, calls };
}

function listHandler(prs: unknown[], files: unknown[] = [], fileHeaders: Record<string, string> = {}) {
  return (url: URL) => {
    if (url.pathname.endsWith('/pulls')) return apiResponse(prs);
    if (url.pathname.endsWith('/files')) return apiResponse(files, fileHeaders);
    throw new Error(`Unexpected URL ${url.pathname}`);
  };
}

const noWait: GitHubClientOptions['sleep'] = async () => {};

describe('GitHub REST repository history', () => {
  it('paginates PR records and changed files without changing API order', async () => {
    const { fetch, calls } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls') && url.searchParams.get('page') === '1') {
        return apiResponse([pull(22)], { link: nextLink('/repos/acme/demo/pulls?page=2') });
      }
      if (url.pathname.endsWith('/pulls') && url.searchParams.get('page') === '2') return apiResponse([pull(21)]);
      if (url.pathname.endsWith('/files') && url.searchParams.get('page') === '1') {
        return apiResponse([{ filename: 'src/a.ts', status: 'modified' }], { link: nextLink('/repos/acme/demo/pulls/22/files?page=2') });
      }
      if (url.pathname.endsWith('/files') && url.searchParams.get('page') === '2') return apiResponse([{ filename: 'src/b.ts', status: 'added' }]);
      if (url.pathname.endsWith('/files')) return apiResponse([]);
      throw new Error(`Unexpected URL ${url.pathname}`);
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 2, { fetch, sleep: noWait });
    expect(history.pullRequests.map(pr => pr.number)).toEqual([22, 21]);
    expect(history.pullRequestListComplete).toBe(true);
    expect(history.pullRequests[0]?.fixture.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(history.pullRequests[0]?.filesComplete).toBe(true);
    expect(calls.map(call => call.url.searchParams.get('page'))).toEqual([null, '1', '2', '1', '2', '1', '2']);
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('marks a limited recent-PR list as incomplete when GitHub reports another page', async () => {
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) return apiResponse([pull(4)], { link: nextLink('/repos/acme/demo/pulls?page=2') });
      return apiResponse([]);
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait });
    expect(history.pullRequests).toHaveLength(1);
    expect(history.pullRequestListComplete).toBe(false);
    expect(history.pullRequestListHasMore).toBe(true);
  });

  it('retains collected PRs and marks the sample incomplete if a later PR page fails', async () => {
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls') && url.searchParams.get('page') === '1') {
        return apiResponse([pull(7)], { link: nextLink('/repos/acme/demo/pulls?page=2') });
      }
      if (url.pathname.endsWith('/pulls')) return apiResponse({ message: 'permission denied' }, {}, 403);
      return apiResponse([]);
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 2, { fetch, sleep: noWait });
    expect(history.pullRequests.map(pr => pr.number)).toEqual([7]);
    expect(history.pullRequestListComplete).toBe(false);
    expect(history.pullRequestListIncompleteReason).toContain('403 Forbidden');
  });

  it('returns an honest empty history for repositories with no PRs', async () => {
    const { fetch } = fakeFetch(() => apiResponse([]));
    const history = await collectGitHubRepositoryHistory('acme/empty', 50, { fetch, sleep: noWait });
    expect(history.pullRequests).toEqual([]);
    expect(history.pullRequestListComplete).toBe(true);
    expect(history.pullRequestListHasMore).toBe(false);
  });

  it('refuses private repositories even when a token could read them', async () => {
    let pullListRequests = 0;
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) pullListRequests += 1;
      return apiResponse([]);
    }, { private: true, visibility: 'private' });
    await expect(collectGitHubRepositoryHistory('acme/private', 1, { token: 'token', fetch, sleep: noWait }))
      .rejects.toThrow('does not confirm a public');
    expect(pullListRequests).toBe(0);
  });

  it('uses both names for renames and the old path for deleted files', async () => {
    const files = [
      { filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed' },
      { filename: 'src/deleted.ts', status: 'removed' },
    ];
    const { fetch } = fakeFetch(listHandler([pull(1)], files));
    const history = await collectGitHubRepositoryHistory('acme/demo', 10, { fetch, sleep: noWait });
    expect(history.pullRequests[0]?.fixture.changedFiles).toEqual([
      'src/new.ts', 'src/old.ts', 'src/deleted.ts',
    ]);
    expect(history.pullRequests[0]?.filesComplete).toBe(true);
  });

  it('marks a rename with missing previous_filename incomplete while retaining its reported path', async () => {
    const { fetch } = fakeFetch(listHandler([pull(1)], [
      { filename: 'src/new.ts', status: 'renamed' },
    ]));
    const history = await collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait });
    expect(history.pullRequests[0]?.fixture.changedFiles).toEqual(['src/new.ts']);
    expect(history.pullRequests[0]?.filesComplete).toBe(false);
    expect(history.pullRequests[0]?.filesIncompleteReason).toContain('previous filename');
  });

  it('keeps a partial file page but marks the path decision unknown after a later page fails', async () => {
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) return apiResponse([pull(1)]);
      if (url.searchParams.get('page') === '1') {
        return apiResponse([{ filename: 'src/app.ts', status: 'modified' }], {
          link: nextLink('/repos/acme/demo/pulls/1/files?page=2'),
        });
      }
      return apiResponse({ message: 'forbidden' }, {}, 403);
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait });
    expect(history.pullRequests[0]?.fixture.changedFiles).toEqual(['src/app.ts']);
    expect(history.pullRequests[0]?.filesComplete).toBe(false);
    const report = createGitHubReport(
      "on:\n  pull_request:\n    paths: ['src/**']",
      'on: pull_request',
      'github.com',
      history,
    );
    expect(report.comparisons[0]?.before.decision).toBe('unknown');
    expect(report.comparisons[0]?.filesIncompleteReason).toContain('403 Forbidden');
  });

  it('omits PR records without an API number and reports the collection as incomplete', async () => {
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) return apiResponse([pull(0)]);
      throw new Error('An unnumbered PR must not trigger a file request');
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait });
    expect(history.pullRequests).toEqual([]);
    expect(history.pullRequestListComplete).toBe(false);
    expect(history.pullRequestListIncompleteReason).toContain('required metadata');
  });

  it('keeps missing branch and file metadata unknown instead of inventing values', async () => {
    const { fetch } = fakeFetch(listHandler(
      [pull(1, { base: {} })],
      [{ filename: 'src/a.ts' }],
    ));
    const history = await collectGitHubRepositoryHistory('acme/demo', 10, { fetch, sleep: noWait });
    expect(history.pullRequests[0]?.baseBranch).toBeNull();
    expect(history.pullRequests[0]?.filesComplete).toBe(false);
    expect(history.pullRequests[0]?.filesIncompleteReason).toContain('status');
    const report = createGitHubReport(
      'on:\n  pull_request:\n    branches: [main]',
      'on: push',
      'github.com',
      history,
    );
    expect(report.comparisons[0]?.before.decision).toBe('unknown');
    expect(report.comparisons[0]?.after.decision).toBe('skip');
    expect(report.eventScenario.actionIsHypothetical).toBe(true);
  });

  it('marks exactly 3,000 returned files incomplete because the API cannot prove more do not exist', async () => {
    let filePages = 0;
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) return apiResponse([pull(1)]);
      filePages += 1;
      const headers = filePages < 30 ? { link: nextLink(`/repos/acme/demo/pulls/1/files?page=${filePages + 1}`) } : {};
      return apiResponse(Array.from({ length: 100 }, (_, i) => ({
        filename: `docs/${(filePages - 1) * 100 + i}.md`, status: 'modified',
      })), headers);
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait });
    expect(filePages).toBe(30);
    expect(history.pullRequests[0]?.changedFileCount).toBe(3000);
    expect(history.pullRequests[0]?.filesComplete).toBe(false);
    expect(history.pullRequests[0]?.filesIncompleteReason).toContain('3,000-file API limit');
    expect(history.pullRequests[0]?.fixture.filesComplete).toBe(false);
  });

  it('does not request past 3,000 files when GitHub signals an additional page', async () => {
    let filePages = 0;
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) return apiResponse([pull(1)]);
      filePages += 1;
      const headers = filePages < 30 || filePages === 30 ? { link: nextLink(`/repos/acme/demo/pulls/1/files?page=${filePages + 1}`) } : {};
      return apiResponse(Array.from({ length: 100 }, (_, i) => ({
        filename: `docs/${(filePages - 1) * 100 + i}.md`, status: 'modified',
      })), headers);
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait });
    expect(filePages).toBe(30);
    expect(history.pullRequests[0]?.filesComplete).toBe(false);
    expect(history.pullRequests[0]?.filesIncompleteReason).toContain('3,000-file API limit');
  });

  it('retries transient server failures a bounded number of times', async () => {
    let attempts = 0;
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) {
        attempts += 1;
        return attempts < 3 ? apiResponse({ message: 'server error' }, {}, 503) : apiResponse([]);
      }
      return apiResponse([]);
    });
    const history = await collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait });
    expect(history.pullRequests).toEqual([]);
    expect(attempts).toBe(3);
  });

  it('retries rate limits only when the bounded wait fits and preserves read-only access', async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const { fetch, calls } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) {
        attempts += 1;
        return attempts === 1
          ? apiResponse({ message: 'rate limited' }, { 'x-ratelimit-remaining': '0', 'retry-after': '1' }, 403)
          : apiResponse([]);
      }
      return apiResponse([]);
    });
    await collectGitHubRepositoryHistory('acme/demo', 1, {
      token: 'never-print-this-token', fetch,
      sleep: async milliseconds => { sleeps.push(milliseconds); },
    });
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(calls[0]?.authorization).toBe('token never-print-this-token');
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('does not retry authentication and non-rate-limit permission failures', async () => {
    for (const status of [401, 403]) {
      let attempts = 0;
      const { fetch } = fakeFetch(url => {
        if (url.pathname.endsWith('/pulls')) {
          attempts += 1;
          return apiResponse({ message: 'denied' }, {}, status);
        }
        return apiResponse([]);
      });
      await expect(collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait }))
        .rejects.toThrow(status === 401 ? '401 Unauthorized' : '403 Forbidden');
      expect(attempts).toBe(1);
    }
  });

  it('reports a bounded rate-limit error when GitHub asks for a long wait', async () => {
    let attempts = 0;
    const { fetch } = fakeFetch(url => {
      if (url.pathname.endsWith('/pulls')) {
        attempts += 1;
        return apiResponse({ message: 'rate limited' }, { 'retry-after': '90' }, 429);
      }
      return apiResponse([]);
    });
    await expect(collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait }))
      .rejects.toThrow('rate limit reached');
    expect(attempts).toBe(1);
  });

  it('retries timed-out fetches at most twice and reports timeout without leaking details', async () => {
    let attempts = 0;
    const fetch: typeof globalThis.fetch = async () => {
      attempts += 1;
      throw Object.assign(new Error('Request timed out; secret URL'), { name: 'TimeoutError' });
    };
    await expect(collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait, timeoutMs: 5 }))
      .rejects.toThrow('timed out after 5 ms');
    expect(attempts).toBe(3);
  });

  it('enforces the configured timeout through an abort signal for each request', async () => {
    let attempts = 0;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      attempts += 1;
      const signal = init?.signal;
      if (!signal) throw new Error('timeout signal missing');
      return new Promise<Response>((_resolve, reject) => {
        const timeout = () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        if (signal.aborted) timeout();
        else signal.addEventListener('abort', timeout, { once: true });
      });
    };
    await expect(collectGitHubRepositoryHistory('acme/demo', 1, { fetch, sleep: noWait, timeoutMs: 5 }))
      .rejects.toThrow('timed out after 5 ms');
    expect(attempts).toBe(3);
  });

  it('validates repository slugs and pull request limits', async () => {
    const { fetch } = fakeFetch(() => apiResponse([]));
    await expect(collectGitHubRepositoryHistory('acme/demo/extra', 1, { fetch })).rejects.toThrow('owner/repository');
    await expect(collectGitHubRepositoryHistory('acme/demo', 101, { fetch })).rejects.toThrow('between 1 and 100');
  });

  it('never includes a configured token in its report', () => {
    const report = createGitHubReport('on: pull_request', 'on: pull_request', 'github.com', {
      owner: 'acme', repository: 'demo', pullRequests: [], requestedLimit: 50,
      pullRequestListComplete: true, pullRequestListHasMore: false,
      pullRequestListIncompleteReason: null,
    });
    expect(JSON.stringify(report)).not.toContain('GITHUB_TOKEN');
    expect(JSON.stringify(report)).not.toContain('never-print-this-token');
  });
});
