import { merged, rows } from '#lib/components/queue.server.ts';
import { storeRoot } from '#lib/store/store.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const root = storeRoot();
	return { rows: rows(root), mergedCount: merged(root).reduce((n, g) => n + g.lines.length, 0) };
};
