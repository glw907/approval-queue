import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { error, fail } from '@sveltejs/kit';
import { beforeMerge } from '#lib/before-merge.ts';
import { fileGroups } from '#lib/diff.ts';
import { render } from '#lib/markdown.ts';
import { bodySections, checksSummary, reviewSection, reviewVerdict, riskClass } from '#lib/pr-summary.ts';
import { nextItem } from '#lib/queue.ts';
import {
	listWaiting,
	readItem,
	writeDecision,
	type Decision,
	type Disposition,
	type SubmittedRow
} from '#lib/server/items.ts';
import type { Actions, PageServerLoad } from './$types';

const DISPOSITIONS: readonly string[] = ['now', 'defer', 'drop'];

/** Reads an item still waiting for a decision; an unknown or decided id is a 404. */
async function readWaiting(id: string) {
	const item = await readItem(APPROVAL_QUEUE_STATE, id);
	if (!item || item.decided) error(404, 'Not found');
	return item;
}

/**
 * Writes the decision and names the item to open next. The next item is picked here, before the
 * write, because the page's own queue can be stale.
 */
async function decide(id: string, decision: Decision) {
	const next = nextItem(await listWaiting(APPROVAL_QUEUE_STATE), id);
	await writeDecision(APPROVAL_QUEUE_STATE, id, decision);
	return { next: next ? `/item/${next.id}` : null };
}

export const load: PageServerLoad = async ({ params }) => {
	const item = await readItem(APPROVAL_QUEUE_STATE, params.id);
	if (!item) error(404, 'Not found');
	const { meta, decided, content } = item;
	if (content.kind === 'pr') {
		const merge = beforeMerge(content.body);
		const review = reviewSection(content.body);
		const { lead, sections } = bodySections(content.body);
		const groups = fileGroups(content.diff);
		const files = groups.flatMap((g) => g.files);
		return {
			meta,
			decided,
			kind: 'pr' as const,
			risk: riskClass(content.body),
			verdict: reviewVerdict(content.body),
			checks: checksSummary(content.pr?.statusCheckRollup),
			link: content.pr
				? { url: content.pr.url, branches: `${content.pr.headRefName} into ${content.pr.baseRefName}` }
				: null,
			leadHtml: render(lead),
			sections: sections.map((s) => ({ title: s.title, html: render(s.body) })),
			reviewHtml: review === null ? null : render(review),
			beforeMergeHtml: merge === null ? null : render(merge),
			groups,
			totals: {
				files: files.length,
				adds: files.reduce((n, f) => n + f.adds, 0),
				dels: files.reduce((n, f) => n + f.dels, 0)
			}
		};
	}
	if (content.kind === 'design') {
		const words = content.doc.split(/\s+/).filter(Boolean).length;
		return { meta, decided, kind: 'design' as const, docHtml: render(content.doc), minutes: Math.ceil(words / 230) };
	}
	const rows = content.rows.map((row) => ({ ...row, disposition: row.proposed, note: '' }));
	return { meta, decided, kind: 'triage' as const, headline: content.headline, lede: content.lede, rows };
};

export const actions: Actions = {
	approve: async ({ params }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind === 'triage') return fail(400, { message: 'Nothing to approve' });
		return decide(params.id, { decision: 'approve' });
	},
	reject: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind === 'triage') return fail(400, { message: 'Nothing to reject' });
		const note = (await request.formData()).get('note');
		return decide(params.id, { decision: 'reject', note: typeof note === 'string' ? note : '' });
	},
	submit: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind !== 'triage') return fail(400, { message: 'Not a triage item' });
		const form = await request.formData();
		const dispositions = form.getAll('disposition');
		const notes = form.getAll('note');
		const source = item.content.rows;
		if (dispositions.length !== source.length || notes.length !== source.length) {
			return fail(400, { message: 'Row count does not match' });
		}
		const rows: SubmittedRow[] = [];
		for (const [i, row] of source.entries()) {
			const disposition = dispositions[i];
			const note = notes[i];
			if (typeof disposition !== 'string' || !DISPOSITIONS.includes(disposition) || typeof note !== 'string') {
				return fail(400, { message: 'Invalid disposition' });
			}
			rows.push({ action: row.action, disposition: disposition as Disposition, note });
		}
		return decide(params.id, { decision: 'submit', rows });
	}
};
