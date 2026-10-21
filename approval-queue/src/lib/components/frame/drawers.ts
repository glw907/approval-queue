import { tick } from 'svelte';
import { desk } from '#lib/desk.svelte.ts';

let opener: HTMLElement | null = null;

/** What goes inert while a drawer is open: everything the drawer does not hold. */
const BEHIND = ['#rail', '.appbar', '#main', '#review'];

function sync() {
	const any = desk.railOpen || desk.paneOpen;
	for (const el of document.querySelectorAll<HTMLElement>(BEHIND.join(','))) {
		el.inert = any && !el.classList.contains('open');
	}
}

/**
 * Opens or closes the queue rail or the review pane as a modal drawer. The page behind goes inert
 * while one is open, focus moves into it, and closing returns focus to the control that opened it.
 */
export async function setDrawer(which: 'rail' | 'pane', open: boolean, from?: HTMLElement | null) {
	if (open === (which === 'rail' ? desk.railOpen : desk.paneOpen)) return;
	if (which === 'rail') desk.railOpen = open;
	else desk.paneOpen = open;
	await tick();
	sync();
	const drawer = document.getElementById(which === 'rail' ? 'rail' : 'review');
	if (open) {
		opener = from ?? (document.activeElement as HTMLElement | null);
		drawer?.querySelector<HTMLElement>('button, a')?.focus();
	} else if (opener) {
		opener.focus();
		opener = null;
	}
}

export function closeDrawers() {
	setDrawer('pane', false);
	setDrawer('rail', false);
}
