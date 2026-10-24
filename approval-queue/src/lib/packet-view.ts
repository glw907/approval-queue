import type { IconName } from '#lib/components/PacketIcon.svelte';

export interface VerdictLook {
	label: string;
	/** The short form on an override segment. */
	short: string;
	icon: IconName;
	ink: string;
}

/** Each verdict reads as text, icon, and ink, so color is never the only signal. */
export const VERDICT_LOOK: Record<string, VerdictLook> = {
	approve: { label: 'Approve', short: 'Approve', icon: 'check', ink: 'v-success' },
	hold: { label: 'Hold', short: 'Hold', icon: 'pause', ink: 'v-warning' },
	'send-back': { label: 'Send back', short: 'Send back', icon: 'undo', ink: 'v-error' },
	session: { label: 'Session runs it', short: 'Session', icon: 'play', ink: 'v-info' },
	you: { label: 'I run it', short: 'Me', icon: 'user', ink: 'v-primary' },
	skip: { label: 'Skip', short: 'Skip', icon: 'skip', ink: 'v-muted' }
};

/** A PR part's files as one line: "3 in 2 groups: docs, src". */
export function filesLine(groups: Array<{ name: string; files: unknown[] }>): string {
	const files = groups.reduce((n, g) => n + g.files.length, 0);
	return `${files} in ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}: ${groups.map((g) => g.name).join(', ')}`;
}

/** The kind a part ref names, for a line that leads with it. */
export const refKind = (ref: string) => (ref.startsWith('step:') ? 'Step' : ref.includes('#') ? 'PR' : 'Design');

/** The verdicts a routine row offers: a step the owner runs cannot go back to the session. */
export function overrideOptions(kind: string, preselected: string): string[] {
	if (kind !== 'step') return ['approve', 'hold', 'send-back'];
	return preselected === 'you' ? ['you', 'skip'] : ['session', 'you', 'skip'];
}

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
