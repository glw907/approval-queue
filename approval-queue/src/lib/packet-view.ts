import type { IconName } from '#lib/components/PacketIcon.svelte';

/** A PR part's files as one line: "3 in 2 groups: docs, src". */
export function filesLine(groups: Array<{ name: string; files: unknown[] }>): string {
	if (groups.length === 0) return 'No files changed';
	const files = groups.reduce((n, g) => n + g.files.length, 0);
	return `${files} in ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}: ${groups.map((g) => g.name).join(', ')}`;
}

/** The kind a part ref names, for a line that leads with it. */
export const refKind = (ref: string) => (ref.startsWith('step:') ? 'Step' : ref.includes('#') ? 'PR' : 'Design');

export interface RuleLook {
	label: string;
	icon: IconName;
	tone: 'error' | 'warning';
}

export const RULE_LOOK: Record<string, RuleLook> = {
	irreversible: { label: 'Irreversible', icon: 'lock', tone: 'error' },
	'public-surface': { label: 'Public surface', icon: 'globe', tone: 'warning' },
	'cross-repo': { label: 'Cross-repo', icon: 'arrows', tone: 'warning' },
	'owner-call': { label: 'Owner call', icon: 'user', tone: 'warning' },
	'low-confidence': { label: 'Low confidence', icon: 'help', tone: 'warning' },
	'gate-failed': { label: 'Gate failed', icon: 'gate', tone: 'error' },
	'contradicts-ruling': { label: 'Contradicts a ruling', icon: 'scale', tone: 'error' }
};
