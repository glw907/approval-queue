<!-- @component
The three-pane frame every review screen sits in: the work centered at reading width, the sticky
decision bar under it, and the review pane pinned right (the queue rail is the layout's). The
screen supplies the work (`children`, led by an optional `FrameHeader`), the pane's content, and
the bar; the frame supplies the place bar and the drawer. Below 1260px the pane is a modal drawer
opened from the place bar, so a screen's pane content must read the same in both places.

A link into the work from the pane closes the drawer before any handler of the screen's runs, so
the work is no longer inert when that handler moves focus. A plain fragment link that no handler
took moves focus to its target itself, rather than leaving it on the pane.

The frame owns `<main id="main">` and `#decision`, which the layout's focus handling and the
screen's bar-height observer look up by id.

A document review takes the `margin` form instead: no review pane, and the page and its comment
margin centered together as one unit with the decision bar across both. The work then renders its
own place bar, between its opening rows and the editor, since that bar spans the unit.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { closeDrawers, closeDrawersForLink, setDrawer } from './drawers.ts';

	interface Props {
		/** The Survey header, `FrameHeader`; a screen that has not adopted it leaves it out. */
		header?: Snippet;
		/** The work. */
		children: Snippet;
		/** The review pane's sections, built from `PaneSection` and `PaneList`; unused in the `margin` form. */
		pane?: Snippet;
		/** A document review: the comment margin takes the pane's place, and the work holds the place bar. */
		margin?: boolean;
		/** The decision bar: the form for a waiting item, or a bar that only says it is decided. */
		bar: Snippet;
		/** What the place bar names, the item the reader is on. */
		where: string;
		/** The pane's name, on its drawer and on the button that opens it. */
		paneLabel?: string;
		/** The place bar's own control before the pane button, such as a link to the next open call. */
		place?: Snippet;
	}

	let { header, children, pane, margin = false, bar, where, paneLabel = 'Review pane', place }: Props = $props();

	let paneButton = $state<HTMLButtonElement>();

	const fragmentLink = (e: Event) =>
		e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;

	/** Focuses a plain link's target once no screen handler took the click. */
	function focusTarget(e: MouseEvent) {
		const link = fragmentLink(e);
		if (!link || e.defaultPrevented) return;
		const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
		if (!target) return;
		if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.tabIndex = -1;
		target.focus({ preventScroll: true });
	}
</script>

<div class={['frame', margin && 'margin']}>
	<main id="main" tabindex="-1" class="frame-main">
		<div class="sheet">
			{@render header?.()}
			{#if !margin}
				<div class="place">
					<span class="where"><b>{where}</b></span>
					{#if place}<span class="open">{@render place()}</span>{/if}
					<button
						type="button"
						class="btn btn-link btn-sm linkbtn"
						bind:this={paneButton}
						aria-expanded={desk.paneOpen}
						aria-controls="review"
						onclick={() => setDrawer('pane', true, paneButton)}>{paneLabel}</button
					>
				</div>
			{/if}
			<div class="work">
				{@render children()}
				<div id="decision" class="barwrap">{@render bar()}</div>
			</div>
		</div>
	</main>
	{#if pane && !margin}
	<aside
		id="review"
		class={['review', desk.paneOpen && 'open']}
		aria-label={paneLabel}
		role={desk.paneOpen ? 'dialog' : undefined}
		aria-modal={desk.paneOpen ? 'true' : undefined}
		onclickcapture={(e) => fragmentLink(e) && closeDrawersForLink()}
		onclick={focusTarget}
	>
		<div class="rv-sticky">
			<button type="button" class="drawer-x btn btn-ghost btn-sm btn-square" aria-label="Close the {paneLabel.toLowerCase()}" onclick={closeDrawers}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
			{@render pane()}
		</div>
	</aside>
	{/if}
</div>
