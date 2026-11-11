/** The grouping and ordering the board and the sidebar share. */

export type Sort = 'asks' | 'oldest';

export const SORT_COOKIE = 'desk-sort';

/** Heading of the group that holds every item that is not a packet. */
export const SINGLES = 'Single items';

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
 * Groups rows by initiative. `SINGLES` comes after them, and "Asks first" ranks a group by its total.
 */
export function boardGroups(rows: BoardRow[], sort: Sort): BoardGroup[] {
	const order = sort === 'asks' ? byAsks : byOldest;
	const map = new Map<string, BoardRow[]>();
	for (const row of rows) {
		map.set(row.group, [...(map.get(row.group) ?? []), row]);
	}
	const total = (g: BoardGroup) => g.rows.reduce((n, r) => n + r.asks, 0);
	const groups = [...map].map(([title, list]) => ({ title, rows: list.sort(order) }));
	const rank = (a: BoardGroup, b: BoardGroup) =>
		(sort === 'asks' ? total(b) - total(a) : 0) || byOldest(a.rows[0], b.rows[0]);
	return [
		...groups.filter((g) => g.title !== SINGLES).sort(rank),
		...groups.filter((g) => g.title === SINGLES)
	];
}

/** The age the board and the sidebar print: minutes, hours, then days. */
export function age(created: string, now = Date.now()) {
	const minutes = Math.max(0, Math.round((now - Date.parse(created)) / 60000));
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
	return `${Math.round(minutes / 1440)}d`;
}

/** `age`, spelled out for a screen reader: "45 minutes", never "45m". */
export function spokenAge(created: string, now = Date.now()) {
	const short = age(created, now);
	const n = Number.parseInt(short, 10);
	const unit = { m: 'minute', h: 'hour', d: 'day' }[short.slice(-1)];
	return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * The row the app opens on: the oldest waiting packet. A single item (a design, a triage list, or an
 * unreadable packet) never opens the app, since its page may not exist or may not be the one to read first.
 */
export function openingRow(rows: BoardRow[]): BoardRow | undefined {
	return rows.filter((row) => !row.single).sort(byOldest)[0];
}

/** What the rail needs of a waiting item to describe it. */
export interface RailItem {
	kind: 'design' | 'triage' | 'packet';
	/** A packet's own kind, from its fact file. */
	packetKind?: 'stop' | 'close' | 'design';
	/** A packet's calls; 0 for any other kind. */
	asks: number;
	created: string;
}

const PACKET_WORD = { stop: 'Pass paused', close: 'Pass finished', design: 'Design' } as const;

/** The line under a rail entry: its kind in words, its calls, and its age, as "Pass paused, 3 calls, 20 minutes ago". */
export function railLine(item: RailItem, now = Date.now()): string {
	const ago = `${spokenAge(item.created, now)} ago`;
	if (item.kind === 'triage') return `Triage list, ${ago}`;
	if (item.kind === 'design') return `Design, ${ago}`;
	const calls = item.asks === 0 ? 'no calls' : `${item.asks} call${item.asks === 1 ? '' : 's'}`;
	return `${PACKET_WORD[item.packetKind ?? 'stop']}, ${calls}, ${ago}`;
}

const dayKey = (time: string) => new Date(time).toLocaleDateString('en-CA');

/** How many digest lines the newest day holds, and that day spelled "10 November"; null when there are none. */
export function digestDay(lines: Array<{ time: string }>): { count: number; day: string } | null {
	if (!lines.length) return null;
	const newest = lines.reduce((a, b) => (b.time > a.time ? b : a));
	const count = lines.filter((line) => dayKey(line.time) === dayKey(newest.time)).length;
	return { count, day: new Date(newest.time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) };
}

/** The digest's line in the rail. It is a sentence about the newest day, never a badge. */
export function digestLine(summary: ReturnType<typeof digestDay>): string {
	if (!summary) return 'Nothing has merged yet';
	return `${summary.count} change${summary.count === 1 ? '' : 's'} on ${summary.day}`;
}

/** A date as "9 November 2026", for a decided item and a digest line. */
export const longDay = (time: string) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** How a decision reads on a screen: "Approved", "Sent back", "Submitted". */
export const decisionWord = (decision: string) =>
	({ approve: 'Approved', reject: 'Sent back', submit: 'Submitted' })[decision] ?? 'Decided';
