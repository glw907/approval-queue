import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePacket } from '#lib/packet.ts';

/** The head each fixture PR is queued at; a PR not listed gets `ddd444`. */
export const HEADS: Record<string, string> = {
	'glw907/drafter#41': 'aaa111',
	'glw907/drafter#42': 'bbb222',
	'glw907/drafter#43': 'ccc333'
};

/**
 * Writes an item directory the way the command lays out a packet: the parse, and for part `k`
 * (its index in `packet.parts`) a `pr.json`, `body.md`, and `diff.patch`, or a `doc.md`.
 */
export async function seedPacket(root: string, id: string, markdown: string, meta: object = {}) {
	const parsed = parsePacket(markdown, { designExists: () => true });
	if (!parsed.ok) throw new Error(parsed.messages.join('\n'));
	const dir = join(root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'packet.md'), markdown);
	await writeFile(join(dir, 'packet.json'), JSON.stringify(parsed.packet));
	for (const [k, { part }] of parsed.packet.parts.entries()) {
		if (part.kind === 'step') continue;
		const partDir = join(dir, 'parts', String(k));
		await mkdir(partDir, { recursive: true });
		if (part.kind === 'pr') {
			const pr = { number: part.number, url: 'u', headRefName: 'h', baseRefName: 'main', statusCheckRollup: [], head: HEADS[part.ref] ?? 'ddd444' };
			await writeFile(join(partDir, 'pr.json'), JSON.stringify(pr));
			await writeFile(join(partDir, 'body.md'), `Body of ${part.ref}`);
			await writeFile(join(partDir, 'diff.patch'), '+a\n');
		} else {
			await writeFile(join(partDir, 'doc.md'), `# Design ${part.ref}\n`);
		}
	}
	await writeFile(
		join(dir, 'item.json'),
		JSON.stringify({ id, kind: 'packet', repo: 'glw907/drafter', title: 't', created: '2026-10-11T10:00:00Z', ...meta })
	);
}
