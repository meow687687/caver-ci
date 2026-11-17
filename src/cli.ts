#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { analyzeWorkflow } from './analyzer.js';
import { parseFixtures } from './fixtures.js';

const program = new Command();
program.name('caver-ci').description('Compare pull request trigger eligibility on GitHub.com').version('0.1.0');
program.command('analyze')
  .requiredOption('--platform <platform>', 'target platform (only github.com is supported)')
  .requiredOption('--base <file>', 'original workflow YAML')
  .requiredOption('--proposed <file>', 'proposed workflow YAML')
  .requiredOption('--prs <file>', 'pull request fixtures JSON')
  .action(async (options: { base: string; proposed: string; prs: string; platform: string }) => {
    const [base, proposed, fixtures] = await Promise.all([options.base, options.proposed, options.prs].map(path => readFile(path, 'utf8')));
    const prs = parseFixtures(JSON.parse(fixtures));
    const comparisons = prs.map(pr => {
      const before = analyzeWorkflow(base, pr, options.platform);
      const after = analyzeWorkflow(proposed, pr, options.platform);
      return { id: pr.id, before, after, change: before.decision === 'unknown' || after.decision === 'unknown' ? 'unknown' : before.decision === after.decision ? 'unchanged' : `${before.decision} -> ${after.decision}` };
    });
    console.log(JSON.stringify({ platform: options.platform, supportedPlatform: 'github.com', comparisons }, null, 2));
  });
try { await program.parseAsync(); } catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
