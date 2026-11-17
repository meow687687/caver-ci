export interface PullRequestFixture {
  id: string;
  baseBranch: string;
  action: string;
  changedFiles: string[];
  filesComplete: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseFixtures(value: unknown): PullRequestFixture[] {
  if (!Array.isArray(value)) throw new Error('PR fixtures must be a JSON array');

  const ids = new Set<string>();
  return value.map((pr, index) => {
    if (!isRecord(pr)) {
      throw new Error(`Invalid PR fixture at index ${index}: expected an object`);
    }

    for (const field of ['id', 'baseBranch', 'action'] as const) {
      const value = pr[field];
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid PR fixture at index ${index}: expected non-empty ${field}`);
      }
    }

    if (!Array.isArray(pr.changedFiles) || !pr.changedFiles.every(
      (path: unknown) => typeof path === 'string' && path.length > 0,
    )) {
      throw new Error(`Invalid PR fixture at index ${index}: expected changedFiles to be an array of non-empty paths`);
    }
    if (typeof pr.filesComplete !== 'boolean') {
      throw new Error(`Invalid PR fixture at index ${index}: expected filesComplete to be a boolean`);
    }
    if (ids.has(pr.id as string)) throw new Error(`Duplicate PR fixture id: ${pr.id as string}`);

    ids.add(pr.id as string);
    return {
      id: pr.id as string,
      baseBranch: pr.baseBranch as string,
      action: pr.action as string,
      changedFiles: pr.changedFiles as string[],
      filesComplete: pr.filesComplete,
    };
  });
}
