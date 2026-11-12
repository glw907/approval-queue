import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { patchName } from '#lib/facts.ts';

const fixtures = new URL('../fixtures/', import.meta.url).pathname;

/** The head each seeded PR is pinned at: `h<k>` for the k-th PR of the fact file, counting from 1. */
export const headOf = (ref: string, prs: string[]) => `h${prs.indexOf(ref) + 1}`;

/**
 * Writes an item directory the way the command lays out a new-shape packet from a `fixtures/` triple
 * (`close`, `stop`, or `design`): the checked files, the snapshot's patches, `heads.json`, a
 * `prs/<k>.json` each, and for a design the copy and its pinned hash, with the path it came from when `designPath` is given. Returns the fact file's PRs.
 */
export async function seedFacts(root: string, id: string, kind: 'close' | 'stop' | 'design', meta: object = {}, designPath?: string): Promise<string[]> {
	const dir = join(root, 'items', id);
	await mkdir(join(dir, 'snapshot'), { recursive: true });
	await mkdir(join(dir, 'prs'), { recursive: true });
	await copyFile(`${fixtures}${kind}-facts.json`, join(dir, 'facts.json'));
	await copyFile(`${fixtures}${kind}-text.md`, join(dir, 'text.md'));
	const facts = JSON.parse(await readFile(`${fixtures}${kind}-facts.json`, 'utf8')) as { prs: string[] };
	for (const [k, ref] of facts.prs.entries()) {
		await copyFile(`${fixtures}snapshot/${patchName(ref)}`, join(dir, 'snapshot', patchName(ref)));
		const pr = { ref, title: `Title of ${ref}`, body: '', checks: [{ name: 'gate', bucket: 'pass' }], files: [{ path: 'a.ts', additions: 1, deletions: 0, rank: 1 }] };
		await writeFile(join(dir, 'prs', `${k}.json`), JSON.stringify(pr));
	}
	await writeFile(join(dir, 'heads.json'), JSON.stringify(facts.prs.map((ref) => ({ ref, head: headOf(ref, facts.prs) }))));
	if (kind === 'design') {
		const md = '# The design\n';
		await writeFile(join(dir, 'design.md'), md);
		await writeFile(join(dir, 'design.json'), JSON.stringify({ sha256: createHash('sha256').update(md).digest('hex'), ...(designPath !== undefined && { path: designPath }) }));
	}
	await writeFile(
		join(dir, 'item.json'),
		JSON.stringify({ id, kind: 'packet', title: 'A packet', initiative: 'sample', created: '2026-11-10T10:00:00Z', ...meta })
	);
	return facts.prs;
}
