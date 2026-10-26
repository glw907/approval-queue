import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePacket } from '#lib/packet.ts';

/** The head each fixture PR is queued at; a PR not listed gets `ddd444`. */
export const HEADS: Record<string, string> = {
	'glw907/sample#41': 'aaa111',
	'glw907/sample#42': 'bbb222',
	'glw907/sample#43': 'ccc333'
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
		JSON.stringify({ id, kind: 'packet', repo: 'glw907/sample', title: 't', created: '2026-10-11T10:00:00Z', ...meta })
	);
}

/** The patch a moved part carries since Geoff sent it back. */
export const SINCE_PATCH = 'diff --git a/notes.md b/notes.md\n--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-old\n+new\n';

/**
 * Writes a packet that resends what `earlier` sent back, as the command lays it out: `revises` in
 * `item.json`, a `since.patch` on glw907/sample#41 (its head moved), and a `since.json` gone marker on
 * glw907/sample#42 (force-pushed). When `sentBack` is given the earlier item's `decision.json` holds it;
 * with none, the earlier item has no decision on disk.
 */
export async function seedRevision(
	root: string,
	id: string,
	markdown: string,
	earlier: string,
	sentBack?: { note: string; calls: object[] }
) {
	await seedPacket(root, id, markdown, {
		revises: {
			item: earlier,
			revision: 2,
			parts: [
				{ ref: 'glw907/sample#41', head: 'aaa000' },
				{ ref: 'glw907/sample#42', head: 'bbb000' }
			]
		}
	});
	await writeFile(join(root, 'items', id, 'parts', '0', 'since.patch'), SINCE_PATCH);
	await writeFile(join(root, 'items', id, 'parts', '1', 'since.json'), JSON.stringify({ gone: true }));
	if (sentBack) {
		const dir = join(root, 'items', earlier);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'decision.json'), JSON.stringify({ decision: 'reject', ...sentBack }));
	}
}
