import { allDocs, merged } from '#lib/server/docs';
import { read } from '#lib/server/store';
import type { ListItem } from '#lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const state = read();
	const items: ListItem[] = allDocs().map((d) => ({
		id: d.id,
		kind: d.kind,
		title: d.title,
		summary: d.summary,
		repo: d.repo,
		sent: d.sent,
		returned: d.returned,
		questions: d.questions,
		decision: state.docs[d.id]?.decision
	}));
	const mergedCount = merged().reduce((n, g) => n + g.lines.length, 0);
	return { items, down: state.down, mergedCount };
};
