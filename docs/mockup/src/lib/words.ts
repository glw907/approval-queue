import type { ListItem } from '#lib/types';
import { count } from '#lib/when';

const TOOLS: Record<string, string> = {
	'glw907/workstation': 'Workstation',
	'glw907/approval-queue': 'Approval Queue',
	'glw907/standards': 'Standards'
};

/** The name Geoff uses for the tool a repo holds: "Workstation" for "glw907/workstation". */
export const toolName = (repo: string) => TOOLS[repo] ?? repo.split('/')[1] ?? repo;

export const plural = (n: number, one: string, many = one + 's') => `${count(n)} ${n === 1 ? one : many}`;

export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The second line of a row in the list: the tool it comes from and how much it asks. */
export function rowNote(item: ListItem): string {
	const tool = toolName(item.repo);
	if (!item.questions) return tool;
	return `${tool}, ${plural(item.questions, 'question').toLowerCase()}`;
}

export const DECIDED = { approve: 'Approved', sendback: 'Sent back', read: 'Read' } as const;
