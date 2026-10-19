/**
 * Sanity-checks `.github/workflows/*.yml` without running Actions: the YAML parses (Bun's built-in parser), every
 * job has `runs-on` and non-empty `steps`, each step has exactly one of `uses` / `run`, every `uses` is pinned to a
 * ref, and `needs` point at existing jobs.  Run: `bun tools/check-workflows.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Step = { uses?: string; run?: string; name?: string };
type Job = { 'runs-on'?: unknown; steps?: Step[]; needs?: string | string[] };

export function checkWorkflow(text: string): string[] {
  const errs: string[] = [];
  let doc: { on?: unknown; jobs?: Record<string, Job> };
  try {
    doc = Bun.YAML.parse(text) as typeof doc;
  } catch (e) {
    return [`YAML parse error: ${(e as Error).message}`];
  }
  if (!doc || typeof doc !== 'object') return ['not a mapping'];
  if (!doc.on) errs.push('missing `on`');
  const jobs = doc.jobs ?? {};
  if (!Object.keys(jobs).length) errs.push('no jobs');
  for (const [id, job] of Object.entries(jobs)) {
    if (!job['runs-on']) errs.push(`${id}: missing runs-on`);
    if (!Array.isArray(job.steps) || !job.steps.length) errs.push(`${id}: no steps`);
    for (const n of [job.needs ?? []].flat()) if (!jobs[n]) errs.push(`${id}: needs unknown job "${n}"`);
    (job.steps ?? []).forEach((s, i) => {
      const where = `${id}.steps[${i}]${s.name ? ` (${s.name})` : ''}`;
      if (!!s.uses === !!s.run) errs.push(`${where}: needs exactly one of uses/run`);
      if (s.uses && !/^[\w.-]+\/[\w./-]+@[\w.-]+$/.test(s.uses))
        errs.push(`${where}: unpinned action "${s.uses}"`);
    });
  }
  return errs;
}

if (import.meta.main) {
  const dir = '.github/workflows';
  let bad = 0;
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const errs = checkWorkflow(readFileSync(join(dir, f), 'utf8'));
    for (const e of errs) console.error(`error ${f}: ${e}`);
    bad += errs.length;
    if (!errs.length) console.log(`ok    ${f}`);
  }
  process.exit(bad ? 1 : 0);
}
