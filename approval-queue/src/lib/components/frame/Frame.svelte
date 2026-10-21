<!-- @component
The three-pane frame every review screen sits in: the work centered at reading width, the sticky
decision bar under it, and the review pane pinned right (the queue rail is the layout's). The
screen supplies the work (`children`, led by an optional `FrameHeader`), the pane's content, and
the bar; the frame supplies the place bar and the drawer. Below 1260px the pane is a modal drawer
opened from the place bar, so a screen's pane content must read the same in both places.

The frame owns `<main id="main">` and `#decision`, which the layout's focus handling and the
screen's bar-height observer look up by id.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { closeDrawers, setDrawer } from './drawers.ts';

	interface Props {
		/** The Survey header, `FrameHeader`; a screen that has not adopted it leaves it out. */
		header?: Snippet;
		/** The work. */
		children: Snippet;
		/** The review pane's sections, built from `PaneSection` and `PaneList`. */
		pane: Snippet;
		/** The decision bar's form; omitted for a decided item, which shows `decided` instead. */
		bar: Snippet;
		/** What the place bar names, the item the reader is on. */
		where: string;
		/** The pane's name, on its drawer and on the button that opens it. */
		paneLabel?: string;
	}

	let { header, children, pane, bar, where, paneLabel = 'Review pane' }: Props = $props();

	let paneButton = $state<HTMLButtonElement>();
</script>

<div class="frame">
	<main id="main" tabindex="-1" class="frame-main">
		<div class="sheet">
			{@render header?.()}
			<div class="place">
				<span class="where"><b>{where}</b></span>
				<button
					type="button"
					class="linkbtn"
					bind:this={paneButton}
					aria-expanded={desk.paneOpen}
					aria-controls="review"
					onclick={() => setDrawer('pane', true, paneButton)}>{paneLabel}</button
				>
			</div>
			<div class="work">
				{@render children()}
				<div id="decision" class="barwrap">{@render bar()}</div>
			</div>
		</div>
	</main>
	<!-- A link into the work closes the drawer, so the target is not left behind a scrim. -->
	<aside
		id="review"
		class={['review', desk.paneOpen && 'open']}
		aria-label={paneLabel}
		role={desk.paneOpen ? 'dialog' : undefined}
		aria-modal={desk.paneOpen ? 'true' : undefined}
		onclick={(e) => e.target instanceof Element && e.target.closest('a[href^="#"]') && closeDrawers()}
	>
		<div class="rv-sticky">
			<button type="button" class="drawer-x" aria-label="Close the {paneLabel.toLowerCase()}" onclick={closeDrawers}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
			{@render pane()}
		</div>
	</aside>
</div>
