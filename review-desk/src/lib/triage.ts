export type Disposition = 'now' | 'defer' | 'drop';

export interface Row {
	/** The item's number as the list prints it. */
	item: string;
	disposition: Disposition;
	/** What the review proposed; a row counts as changed when it differs. */
	proposed: Disposition;
	reason: string;
}

/** Returns a copy with only row `index` changed, so the array's order never shifts under the view. */
export function moveRow<T extends Row>(rows: readonly T[], index: number, disposition: Disposition): T[] {
	return rows.map((row, i) => (i === index ? { ...row, disposition } : row));
}

/** The view: each section's rows in item-number order. */
export function groupRows<T extends Row>(rows: readonly T[]): Record<Disposition, T[]> {
	const groups: Record<Disposition, T[]> = { now: [], defer: [], drop: [] };
	for (const row of rows) groups[row.disposition].push(row);
	for (const list of Object.values(groups)) {
		list.sort((a, b) => a.item.localeCompare(b.item, undefined, { numeric: true }));
	}
	return groups;
}

export function changedCount(rows: readonly Row[]): number {
	return rows.filter((row) => row.disposition !== row.proposed).length;
}
