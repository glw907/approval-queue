import { REVIEW_DESK_STATE } from '$app/env/private';
import { error, fail } from '@sveltejs/kit';
import { beforeMerge } from '#lib/before-merge.ts';
import { classifyDiff } from '#lib/diff.ts';
import { render } from '#lib/markdown.ts';
import { readItem, writeDecision, type Disposition, type TriageRow } from '#lib/server/items.ts';
import type { Actions, PageServerLoad } from './$types';

const DISPOSITIONS: readonly string[] = ['now', 'defer', 'drop'];

/** Reads an item still waiting for a decision; an unknown or decided id is a 404. */
async function readWaiting(id: string) {
	const item = await readItem(REVIEW_DESK_STATE, id);
	if (!item || item.decided) error(404, 'Not found');
	return item;
}

export const load: PageServerLoad = async ({ params }) => {
	const item = await readItem(REVIEW_DESK_STATE, params.id);
	if (!item) error(404, 'Not found');
	const { meta, decided, content } = item;
	if (content.kind === 'pr') {
		const section = beforeMerge(content.body);
		return {
			meta,
			decided,
			kind: 'pr' as const,
			bodyHtml: render(content.body),
			beforeMergeHtml: section === null ? null : render(section),
			diff: classifyDiff(content.diff)
		};
	}
	if (content.kind === 'design') {
		return { meta, decided, kind: 'design' as const, docHtml: render(content.doc) };
	}
	return { meta, decided, kind: 'triage' as const, rows: content.rows };
};

export const actions: Actions = {
	approve: async ({ params }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind === 'triage') return fail(400, { message: 'Nothing to approve' });
		await writeDecision(REVIEW_DESK_STATE, params.id, { decision: 'approve' });
	},
	reject: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind === 'triage') return fail(400, { message: 'Nothing to reject' });
		const note = (await request.formData()).get('note');
		await writeDecision(REVIEW_DESK_STATE, params.id, {
			decision: 'reject',
			note: typeof note === 'string' ? note : ''
		});
	},
	submit: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind !== 'triage') return fail(400, { message: 'Not a triage item' });
		const form = await request.formData();
		const dispositions = form.getAll('disposition');
		const reasons = form.getAll('reason');
		const source = item.content.rows;
		if (dispositions.length !== source.length || reasons.length !== source.length) {
			return fail(400, { message: 'Row count does not match' });
		}
		const rows: TriageRow[] = [];
		for (const [i, row] of source.entries()) {
			const disposition = dispositions[i];
			const reason = reasons[i];
			if (typeof disposition !== 'string' || !DISPOSITIONS.includes(disposition) || typeof reason !== 'string') {
				return fail(400, { message: 'Invalid disposition' });
			}
			rows.push({ item: row.item, disposition: disposition as Disposition, reason });
		}
		await writeDecision(REVIEW_DESK_STATE, params.id, { decision: 'submit', rows });
	}
};
