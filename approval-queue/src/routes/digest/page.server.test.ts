import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get APPROVAL_QUEUE_STATE() {
		return state.root;
	}
}));

import { actions, load } from './+page.server.ts';

const line = (ref: string, claim: string, time = '2026-11-10T12:00:00Z') => JSON.stringify({ time, ref, head: 'h', claim, lane: 'land' });

const post = (fields: Record<string, string>) => {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return actions.note({ request: { formData: async () => form } } as never) as Promise<unknown>;
};
const notesFile = async () => JSON.parse(await readFile(join(state.root, 'digest-notes.json'), 'utf8'));

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-digest-'));
	await writeFile(join(state.root, 'digest.jsonl'), [line('o/alpha#1', 'First.'), line('o/beta#2', 'Second.'), line('o/alpha#3', 'Third.')].join('\n') + '\n');
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

describe('/digest load', () => {
	it('groups the lines by repo, repos in name order and each repo newest first', async () => {
		const { groups } = (await load({ depends() {} } as never)) as { groups: Array<{ repo: string; lines: Array<{ claim: string }> }> };
		expect(groups.map((g) => [g.repo, g.lines.map((l) => l.claim)])).toEqual([
			['o/alpha', ['Third.', 'First.']],
			['o/beta', ['Second.']]
		]);
	});

	it('is empty with no digest.jsonl', async () => {
		await rm(join(state.root, 'digest.jsonl'));
		expect(await load({ depends() {} } as never)).toEqual({ groups: [] });
	});

	it('carries a note and the reply to it on its line', async () => {
		await writeFile(join(state.root, 'digest-notes.json'), JSON.stringify([{ id: 'D1', line: 2, text: 'Why?' }]));
		await writeFile(join(state.root, 'digest-replies.json'), JSON.stringify([{ note: 'D1', outcome: 'answered', text: 'Because.' }]));
		const { groups } = (await load({ depends() {} } as never)) as { groups: Array<{ lines: Array<{ line: number; notes: unknown[]; replies: unknown[] }> }> };
		const second = groups.flatMap((g) => g.lines).find((l) => l.line === 2);
		expect(second).toMatchObject({ notes: [{ id: 'D1', text: 'Why?' }], replies: [{ text: 'Because.' }] });
	});
});

describe('/digest note action', () => {
	it('saves a note on a line with the next D id', async () => {
		await post({ line: '1', text: 'Check this.' });
		await post({ line: '3', text: 'And this.' });
		expect(await notesFile()).toEqual([
			{ id: 'D1', line: 1, text: 'Check this.' },
			{ id: 'D2', line: 3, text: 'And this.' }
		]);
	});

	it('never reuses the id of a note that has a reply, even after that note is cleared', async () => {
		await post({ line: '1', text: 'First.' });
		await post({ line: '3', text: 'Second.' });
		await writeFile(join(state.root, 'digest-replies.json'), JSON.stringify([{ note: 'D2', outcome: 'answered', text: 'Done.' }]));
		await post({ line: '3', text: '' });
		await post({ line: '2', text: 'Third.' });
		expect(await notesFile()).toEqual([
			{ id: 'D1', line: 1, text: 'First.' },
			{ id: 'D3', line: 2, text: 'Third.' }
		]);
	});

	it('rewrites the note a line already has, keeping its id', async () => {
		await post({ line: '1', text: 'First.' });
		await post({ line: '1', text: 'Second.' });
		expect(await notesFile()).toEqual([{ id: 'D1', line: 1, text: 'Second.' }]);
	});

	it('removes the note when the text is cleared', async () => {
		await post({ line: '1', text: 'First.' });
		await post({ line: '1', text: '  ' });
		expect(await notesFile()).toEqual([]);
	});

	it('refuses a line the digest does not have', async () => {
		expect(await post({ line: '9', text: 'x' })).toMatchObject({ status: 400 });
		expect(await post({ line: 'one', text: 'x' })).toMatchObject({ status: 400 });
	});
});
