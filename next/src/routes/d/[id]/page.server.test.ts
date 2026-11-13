import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../../../scripts/page-checks.mjs';
import type { DocStanding, PageDoc } from '#lib/components/types.ts';
import { writeDecision, writeNamed } from '#lib/store/store.ts';
import { load } from './+page.server.ts';

let state: string;
let ids: Record<string, string>;

beforeAll(async () => {
	state = mkdtempSync(join(tmpdir(), 'aq-doc-'));
	process.env.APPROVAL_QUEUE_STATE = state;
	ids = (await seed(state)).ids;
}, 30_000);

afterAll(() => {
	delete process.env.APPROVAL_QUEUE_STATE;
	rmSync(state, { recursive: true, force: true });
});

type Data = { doc: PageDoc; standing: DocStanding; answers: Record<string, number> };

const loaded = async (id: string) => (await load({ params: { id } } as Parameters<typeof load>[0])) as Data;
const open = async (id: string) => (await loaded(id)).doc;

/** Each page's title and its segment count, from the mockup's documents and the two specimens. */
const PAGES: [string, string, number][] = [
	['10-merge-gaps', 'Merge the busy-check fix and the round rules with three known gaps?', 8],
	['20-survey-edit', 'Keep an edit to a file Survey owns, and accept a test with ten findings?', 7],
	['30-round-report', 'The rules for unattended rounds are now in force on this machine', 2],
	['40-queue-design', 'Rebuild the Approval Queue so every item is one document its session wrote?', 4],
	['50-backlog', 'Close the backlog items the queue rewrite makes moot, and write the rest into its design?', 27],
	['markdown', 'Every form of Markdown a document can use', 2],
	['long', 'Rebuild the Approval Queue so every item is one document its session wrote', 2]
];

/**
 * The text of `html` with every `<code>` and `<pre>` element removed, the places a straight quote
 * belongs. Tags go too, so an attribute's quotes don't count.
 */
const outsideCode = (html: string) => html.replace(/<(pre|code)\b[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, '');

describe('the document page', () => {
	it.each(PAGES)('draws %s with its title and its segments', async (name, title, segments) => {
		const doc = await open(ids[name] ?? name);
		expect(doc.title).toBe(title);
		expect(doc.segments).toHaveLength(segments);
	});

	it.each(PAGES)('leaves no straight double quote outside code in %s', async (name) => {
		const doc = await open(ids[name] ?? name);
		for (const seg of doc.segments) {
			if (seg.type === 'html') expect(outsideCode(seg.html)).not.toContain('"');
		}
	});

	it.each(['markdown', 'long'])("serves %s.md as the mockup's specimen has it", (name) => {
		// The build of next/ alone can't reach docs/, so the route carries a copy of each specimen.
		const mockup = fileURLToPath(new URL(`../../../../../docs/mockup/specimen/${name}.md`, import.meta.url));
		expect(readFileSync(fileURLToPath(new URL(`${name}.md`, import.meta.url)), 'utf8')).toBe(readFileSync(mockup, 'utf8'));
	});

	it('counts the passages the returned version changed', async () => {
		const doc = await open(ids['20-survey-edit']);
		expect(doc.returned).toBeTruthy();
		expect(doc.changes).toBe(3);
		expect((await open(ids['10-merge-gaps'])).returned).toBeUndefined();
	});

	it.each(['../x', '20991231-235959-abcdef'])('answers %s with a 404', async (id) => {
		const thrown = await open(id).then(
			() => null,
			(e: unknown) => e
		);
		expect(isHttpError(thrown, 404)).toBe(true);
		expect((thrown as { body: { message: string } }).body.message).toBe('The queue has no document at this address.');
	});

	it('gives a specimen the waiting state and no stored answers', async () => {
		const data = await loaded('markdown');
		expect(data.standing).toEqual({ state: 'waiting', n: null, decision: null });
		expect(data.answers).toEqual({});
	});

	it("gives a stored document its folded state and the answers picked before a decision", async () => {
		const backlog = ids['50-backlog'];
		writeNamed(join(state, 'store'), backlog, 'answers.json', { q1: 1, q2: 0 });
		expect((await loaded(backlog)).answers).toEqual({ q1: 1, q2: 0 });
		const report = ids['30-round-report'];
		const at = new Date().toISOString();
		writeDecision(join(state, 'store'), report, { action: 'read', at });
		expect((await loaded(report)).standing).toEqual({ state: 'decided', n: 1, decision: { action: 'read', at } });
	});
});
