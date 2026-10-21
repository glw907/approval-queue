import { tick } from 'svelte';
import { desk } from '#lib/desk.svelte.ts';

let opener: HTMLElement | null = null;
/** The elements `shut` made inert, so `sync` clears only those and never an `inert` set elsewhere. */
const shutting = new Set<HTMLElement>();

/** What goes inert while a drawer is open: everything the drawer does not hold. */
const BEHIND = ['#rail', '.appbar', '#main', '#review'];

/**
 * Makes `el` inert, unless it holds the open drawer, as `#main` holds a document's comment margin:
 * then only its children that do not hold the drawer go inert, so the drawer stays usable.
 */
function shut(el: Element, drawer: Element) {
	if (el === drawer) return;
	if (!el.contains(drawer)) {
		(el as HTMLElement).inert = true;
		shutting.add(el as HTMLElement);
		return;
	}
	for (const child of el.children) shut(child, drawer);
}

function sync() {
	for (const el of shutting) el.inert = false;
	shutting.clear();
	const drawer = desk.railOpen ? document.getElementById('rail') : desk.paneOpen ? document.getElementById(desk.pane) : null;
	if (!drawer) return;
	for (const el of document.querySelectorAll(BEHIND.join(','))) shut(el, drawer);
}

/**
 * Opens or closes the queue rail or a pane as a modal drawer: the review pane, or the comment margin
 * whose id `pane` names. The page behind goes inert while one is open, focus moves into it, and
 * closing returns focus to the control that opened it.
 */
export async function setDrawer(which: 'rail' | 'pane', open: boolean, from?: HTMLElement | null, pane = 'review') {
	if (open === (which === 'rail' ? desk.railOpen : desk.paneOpen) && (which === 'rail' || !open || desk.pane === pane)) return;
	// Switching from one pane to another keeps the first one's opener: focus is now inside the pane being hidden.
	const switching = open && which === 'pane' && desk.paneOpen;
	if (which === 'rail') desk.railOpen = open;
	else {
		if (open) desk.pane = pane;
		desk.paneOpen = open;
	}
	await tick();
	sync();
	const drawer = document.getElementById(which === 'rail' ? 'rail' : desk.pane);
	if (open) {
		if (!switching) opener = from ?? (document.activeElement as HTMLElement | null);
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

/**
 * Closes every drawer at once and leaves focus alone, for a link that moves focus to its own
 * target: the page behind must stop being inert before that target can take focus, and handing
 * focus back to the drawer's opener afterward would undo the move.
 */
export function closeDrawersForLink() {
	if (!desk.railOpen && !desk.paneOpen) return;
	desk.railOpen = false;
	desk.paneOpen = false;
	opener = null;
	sync();
}
