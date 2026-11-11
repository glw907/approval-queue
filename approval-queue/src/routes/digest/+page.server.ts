import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { fail } from '@sveltejs/kit';
import { readDigest, readDigestNotes, writeDigestNotes, type DigestNote } from '#lib/server/digest.ts';
import type { Actions, PageServerLoad } from './$types';

/** Loads the digest's lines grouped by repo, each with its notes and the session's replies. */
export const load: PageServerLoad = async ({ depends }) => {
	depends('desk:queue');
	return { groups: await readDigest(APPROVAL_QUEUE_STATE) };
};

export const actions: Actions = {
	/** Saves the note on one digest line as typed: the line keeps one note, and blank text removes it. */
	note: async ({ request }) => {
		const form = await request.formData().catch(() => null);
		const line = Number(form?.get('line'));
		const text = String(form?.get('text') ?? '').trim();
		const known = (await readDigest(APPROVAL_QUEUE_STATE)).some((group) => group.lines.some((l) => l.line === line));
		if (!Number.isInteger(line) || !known) return fail(400, { message: 'That line is not in the digest' });
		const notes = await readDigestNotes(APPROVAL_QUEUE_STATE);
		const mine = notes.find((n) => n.line === line);
		const others = notes.filter((n) => n.line !== line);
		let next: DigestNote[];
		if (!text) next = others;
		else {
			const id = mine?.id ?? `D${Math.max(0, ...notes.map((n) => Number(n.id.slice(1)) || 0)) + 1}`;
			next = [...others, { id, line, text }].sort((a, b) => a.line - b.line);
		}
		await writeDigestNotes(APPROVAL_QUEUE_STATE, next);
		return { saved: line };
	}
};
