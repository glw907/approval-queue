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
	/** The unattended round the packet belongs to, from its `item.json`. */
	round?: string;
	/** The repo names (the part after the slash) the packet's parts hold, once each. */
	repoNames?: string[];
	/** The session that queued the item is gone, so the row says nothing is waiting for the answer. */
	orphaned: boolean;
}

/** The `single` label of a round report's row. */
export const ROUND_REPORT = 'Round report';

/** A run of one group's rows under one round heading; the rows with no round form a section with no heading. */
export interface BoardSection {
	round?: string;
	heading?: string;
	rows: BoardRow[];
}

export interface BoardGroup {
	title: string;
	/** Every row of the group, in the chosen order. */
	rows: BoardRow[];
	/** The rows with no round first, then one section per round. */
	sections: BoardSection[];
}

/** The group title of a waiting packet: its initiative's title, else the id, else "No initiative". */
export const groupTitle = (meta: { initiativeTitle?: string; initiative?: string }): string =>
	meta.initiativeTitle || (meta.initiative && meta.initiative !== 'none' ? meta.initiative : 'No initiative');

const roundHeading = (round: string, rows: BoardRow[]): string => {
	const names = [...new Set(rows.flatMap((r) => r.repoNames ?? []))].sort();
	return names.length ? `Round ${round} \u00b7 ${names.join(', ')}` : `Round ${round}`;
};

const byOldest = (a: BoardRow, b: BoardRow) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id);
const byAsks = (a: BoardRow, b: BoardRow) => b.asks - a.asks || byOldest(a, b);
/** The row a section or group ranks by: its first packet or item, and the report only when nothing else is there. */
const lead = (rows: BoardRow[]) => rows.find((r) => r.single !== ROUND_REPORT) ?? rows[0];

/**
 * Groups rows by initiative. `SINGLES` comes after them, and "Asks first" ranks a group by its total.
 */
export function boardGroups(rows: BoardRow[], sort: Sort): BoardGroup[] {
	const order = sort === 'asks' ? byAsks : byOldest;
	const map = new Map<string, BoardRow[]>();
	for (const row of rows) {
		map.set(row.group, [...(map.get(row.group) ?? []), row]);
	}
	const total = (list: BoardRow[]) => list.reduce((n, r) => n + r.asks, 0);
	const sectionsOf = (list: BoardRow[]): BoardSection[] => {
		const byRound = new Map<string, BoardRow[]>();
		for (const r of list) if (r.round) byRound.set(r.round, [...(byRound.get(r.round) ?? []), r]);
		const loose = list.filter((r) => !r.round);
		const rounds = [...byRound]
			.map(([round, rs]) => ({ round, heading: roundHeading(round, rs), rows: rs }))
			.sort((a, b) => (sort === 'asks' ? total(b.rows) - total(a.rows) : 0) || byOldest(lead(a.rows), lead(b.rows)))
			// The report leads its round, and moves only after the sections are ranked, so it never changes how its round ranks, whatever its age.
			.map((r) => ({ ...r, rows: [...r.rows.filter((x) => x.single === ROUND_REPORT), ...r.rows.filter((x) => x.single !== ROUND_REPORT)] }));
		return [...(loose.length ? [{ rows: loose }] : []), ...rounds];
	};
	const groups = [...map].map(([title, list]) => {
		const rows = list.sort(order);
		return { title, rows, sections: sectionsOf(rows) };
	});
	const rank = (a: BoardGroup, b: BoardGroup) =>
		(sort === 'asks' ? total(b.rows) - total(a.rows) : 0) || byOldest(lead(a.rows), lead(b.rows));
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
	kind: 'design' | 'triage' | 'packet' | 'report';
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
	if (item.kind === 'report') return `Round report, ${ago}`;
	const calls = item.asks === 0 ? 'no calls' : `${item.asks} call${item.asks === 1 ? '' : 's'}`;
	return `${PACKET_WORD[item.packetKind ?? 'stop']}, ${calls}, ${ago}`;
}

/** The waiting items the rail groups: those with no round in the order given, then initiative groups that hold a round. */
export function railRounds<T extends { created: string; kind?: string; round?: string; initiative?: string; initiativeTitle?: string }>(
	items: T[]
): { loose: T[]; groups: Array<{ title: string; rounds: Array<{ round: string; items: T[] }> }> } {
	const oldest = (list: T[]) => list.reduce((a, i) => (i.created < a ? i.created : a), list[0].created);
	const byGroup = new Map<string, Map<string, T[]>>();
	for (const item of items) {
		if (!item.round) continue;
		const title = groupTitle(item);
		const rounds = byGroup.get(title) ?? new Map<string, T[]>();
		rounds.set(item.round, [...(rounds.get(item.round) ?? []), item]);
		byGroup.set(title, rounds);
	}
	const groups = [...byGroup].map(([title, rounds]) => ({
		title,
		rounds: [...rounds]
			.map(([round, list]) => ({ round, items: [...list.filter((i) => i.kind === 'report'), ...list.filter((i) => i.kind !== 'report')] }))
			.sort((a, b) => oldest(a.items).localeCompare(oldest(b.items)))
	}));
	groups.sort((a, b) => oldest(a.rounds[0].items).localeCompare(oldest(b.rounds[0].items)));
	return { loose: items.filter((i) => !i.round), groups };
}

/** One repo's digest lines (newest first) as sections: one with no heading when no line has a round, else a section per round, then "No round". */
export function digestSections<T extends { time: string; round?: unknown }>(lines: T[]): Array<{ heading?: string; lines: T[] }> {
	const roundOf = (l: T) => (typeof l.round === 'string' && l.round !== '' ? l.round : undefined);
	if (!lines.some(roundOf)) return [{ lines }];
	const byRound = new Map<string, T[]>();
	for (const l of lines) {
		const r = roundOf(l);
		if (r) byRound.set(r, [...(byRound.get(r) ?? []), l]);
	}
	const newest = (list: T[]) => list.reduce((a, l) => (l.time > a ? l.time : a), list[0].time);
	const rounds = [...byRound].sort((a, b) => newest(b[1]).localeCompare(newest(a[1]))).map(([r, list]) => ({ heading: `Round ${r}`, lines: list }));
	const none = lines.filter((l) => !roundOf(l));
	return [...rounds, ...(none.length ? [{ heading: 'No round', lines: none }] : [])];
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
	({ approve: 'Approved', reject: 'Sent back', submit: 'Submitted', read: 'Read' })[decision] ?? 'Decided';
