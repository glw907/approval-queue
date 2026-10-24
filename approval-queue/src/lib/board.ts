/** The grouping and ordering the board and the sidebar share. */

export type Sort = 'asks' | 'oldest';

export const SORT_COOKIE = 'desk-sort';

/** Heading of the group that holds every item that is not a packet. */
export const SINGLES = 'Single items';

/** Heading of the group that holds every item Geoff deferred, whatever its kind or initiative. */
export const DEFERRED = 'Deferred';

export interface BoardRow {
	id: string;
	headline: string;
	/** The group the row sits under: an initiative's title, or `SINGLES`. */
	group: string;
	/** ISO 8601 UTC. */
	created: string;
	asks: number;
	/** The rule ids of the asks, once each. */
	rules: string[];
	repos: number;
	/** True when an approve runs a step or an ask that cannot be undone. */
	irreversible: boolean;
	/** Set on an item that is not a packet; the board names its kind in place of its asks. */
	single?: string;
	/** Geoff deferred the item, so it shows under `DEFERRED`. */
	deferred: boolean;
	/** The session that queued the item is gone, so the row says nothing is waiting for the answer. */
	orphaned: boolean;
}

export interface BoardGroup {
	title: string;
	rows: BoardRow[];
}

const byOldest = (a: BoardRow, b: BoardRow) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id);
const byAsks = (a: BoardRow, b: BoardRow) => b.asks - a.asks || byOldest(a, b);

/**
 * Groups rows by initiative. `SINGLES` comes after them and `DEFERRED` last, and "Asks first" ranks a
 * group by its total. A deferred row sits under `DEFERRED` whatever its own group.
 */
export function boardGroups(rows: BoardRow[], sort: Sort): BoardGroup[] {
	const order = sort === 'asks' ? byAsks : byOldest;
	const map = new Map<string, BoardRow[]>();
	for (const row of rows) {
		const group = row.deferred ? DEFERRED : row.group;
		map.set(group, [...(map.get(group) ?? []), row]);
	}
	const total = (g: BoardGroup) => g.rows.reduce((n, r) => n + r.asks, 0);
	const groups = [...map].map(([title, list]) => ({ title, rows: list.sort(order) }));
	const rank = (a: BoardGroup, b: BoardGroup) =>
		(sort === 'asks' ? total(b) - total(a) : 0) || byOldest(a.rows[0], b.rows[0]);
	return [
		...groups.filter((g) => g.title !== SINGLES && g.title !== DEFERRED).sort(rank),
		...groups.filter((g) => g.title === SINGLES),
		...groups.filter((g) => g.title === DEFERRED)
	];
}

/** The age the board and the sidebar print: minutes, hours, then days. */
export function age(created: string, now = Date.now()) {
	const minutes = Math.max(0, Math.round((now - Date.parse(created)) / 60000));
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
	return `${Math.round(minutes / 1440)}d`;
}
