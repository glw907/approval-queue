<!-- @component
A markdown document under review and its comment margin, as one unit: the editor on the left in a
CodeMirror 6 editor, with the file name, the Comment button, the switch that marks changed lines,
and the save state in a bar above, and the margin of cards beside it (a drawer below 1260px). The
source is styled the way cairn's admin editor styles it, and each note, comment, and thread
highlights its text. The editor is built on mount, so the server render shows the loading line;
until then, and if scripts fail, nothing is editable.

All state lives in the `DocReview` it is handed, which the margin and the decision bar read too:
whether the text takes edits and comments come from it. Edits save through that review; this
component only shows the result. Leaving with an edit not yet saved sends it on the way out, so a
quick navigation never drops the last words typed.

A mouse selection in the text opens a comment box beside it from 1260px, and a press back in the
text drops a box left empty. Below 1260px a tap on a highlight opens the drawer at its card.
-->
<script lang="ts">
	import type { EditorView } from '@codemirror/view';
	import { onMount } from 'svelte';
	import { WIDE_MARGIN } from '#lib/editor/margin.ts';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import { createEditor, setCommentable, setMarkChanges, setReadonly, uncollapseAll } from '#lib/editor/setup.ts';
	import Margin from './Margin.svelte';

	interface Props {
		review: DocReview;
		/** The file name the bar shows, such as `debug-your-site.md`. */
		file: string;
		/** The editable region's accessible name; it names the file, since a screen can hold several. */
		label: string;
		/** The page's text at the PR's merge base. Set, the editor shows the diff against it, unchanged runs folded. */
		base?: string;
		/** The margin's card heading level: 4 where the editor sits under its own document's h2, else 3. */
		level?: 3 | 4;
	}

	let { review, file, label, base, level }: Props = $props();

	let host = $state<HTMLDivElement>();
	let view = $state.raw<EditorView | null>(null);

	onMount(() => {
		if (!host) return;
		const v = createEditor(host, {
			doc: review.text,
			notes: review.notes,
			original: review.original,
			label,
			decided: $state.snapshot(review.decided),
			resolved: $state.snapshot(review.resolved),
			comments: $state.snapshot(review.ranges),
			readonly: review.readonly,
			commentable: review.canComment,
			base,
			hooks: review.hooks
		});
		review.attach(v);
		view = v;
		const track = () => review.track();
		const release = () => review.pointerUp();
		window.addEventListener('scroll', track, { passive: true });
		document.addEventListener('pointerup', release);
		track();
		return () => {
			window.removeEventListener('scroll', track);
			document.removeEventListener('pointerup', release);
			if (review.pending) void review.flush();
			review.attach(null);
			v.destroy();
		};
	});

	$effect(() => {
		if (view) setReadonly(view, review.readonly);
	});

	$effect(() => {
		if (view) setCommentable(view, review.canComment);
	});

	$effect(() => {
		if (view) setMarkChanges(view, review.markChanges);
	});

	/** A click on the padding around the text still lands the caret in it. */
	function focusFromPadding(e: MouseEvent) {
		if (e.target === host && view) {
			e.preventDefault();
			view.focus();
		}
	}

	function pointerDown(e: PointerEvent) {
		review.pointerDown(e.button === 0 && e.target instanceof Element && e.target.closest('.cm-content') !== null);
	}

	/** Below 1260px a tap on a highlight opens the drawer at its card. */
	function tapHighlight(e: MouseEvent) {
		if (matchMedia(WIDE_MARGIN).matches || !review.selectionEmpty || !(e.target instanceof Element)) return;
		const id = e.target.closest('.cm-cmt, .cm-anchor')?.getAttribute('aria-details');
		if (!id || id === 'comment-draft') return;
		void review.showCard(id.replace('-', ':'));
	}

	/** The bar's Comment button acts on pointerdown, before the editor would lose its selection to the press. */
	function commentDown(e: PointerEvent) {
		e.preventDefault();
		void review.openBox();
	}
</script>

<div class="unit">
	<div class="edwrap">
		<div class="edbar">
			<span class="fname">{file}</span>
			{#if review.canComment}
				<button
					type="button"
					class="btn btn-link btn-sm linkbtn addc"
					aria-keyshortcuts="Control+Alt+M"
					aria-disabled={review.selectionEmpty}
					title="Select text to comment on it"
					onpointerdown={commentDown}
					onclick={(e) => e.detail === 0 && void review.openBox()}
				>
					Comment <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Alt</kbd><kbd aria-hidden="true">M</kbd>
				</button>
			{/if}
			{#if base !== undefined && view}
				<button type="button" class="btn btn-link btn-sm linkbtn addc" onclick={() => uncollapseAll(view!)}>Show all unchanged lines</button>
			{/if}
			{#if review.editable}
				<label class="marks"><input type="checkbox" class="toggle toggle-sm" bind:checked={review.markChanges} /> Mark the lines you changed</label>
			{/if}
			<!-- Not a live region: the review announces a failed save, not every pause in typing. -->
			<span class={['esaved', review.saveFailed && 'failed']}>{review.saveStatus}</span>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events: the padding forwards a pointer press to the editor, which has its own keyboard focus, and a tap on a highlight opens its card, which Ctrl+Alt+N reaches from the keyboard -->
		<div
			class="cm-host"
			bind:this={host}
			onmousedown={focusFromPadding}
			onpointerdown={pointerDown}
			onclick={tapHighlight}
		></div>
		{#if !view}<p class="loading">Loading the editor…</p>{/if}
	</div>
	<Margin {review} {level} />
</div>

<style>
	.edwrap {
		position: relative;
		margin-top: 10px;
		background: var(--site-field-bg);
		border: 1px solid var(--site-field-border);
		border-radius: var(--radius-box);
		--pad: 24px;
	}
	.edwrap:focus-within {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}
	.edbar {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 7px var(--pad);
		border-bottom: 1px solid var(--color-base-300);
		background: var(--color-base-200);
		border-radius: calc(var(--radius-box) - 1px) calc(var(--radius-box) - 1px) 0 0;
		font-size: 0.8rem;
		color: var(--color-muted);
	}
	.fname {
		font-family: var(--font-mono);
		color: var(--color-base-content);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.addc {
		margin-left: 12px;
		font-size: 0.8rem;
	}
	/* daisyUI dims an aria-disabled button to 20% ink and cuts its pointer events, which would kill
	   the tooltip and the pointerdown hint; the click guard stays in script. */
	.addc[aria-disabled='true'] {
		--btn-color: var(--color-muted);
		color: var(--color-muted);
		pointer-events: auto;
		text-decoration: none;
		cursor: default;
	}
	.marks {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		margin-left: auto;
		cursor: pointer;
		white-space: nowrap;
	}
	.esaved {
		margin-left: auto;
		text-align: right;
		white-space: nowrap;
	}
	.marks + .esaved {
		margin-left: 14px;
	}
	@media (max-width: 1023.98px) {
		.addc kbd {
			display: none;
		}
	}
	@media (max-width: 479.98px) {
		.edbar {
			flex-wrap: wrap;
		}
		.marks + .esaved {
			flex-basis: 100%;
			margin-left: 0;
			text-align: left;
		}
	}
	.esaved.failed {
		color: var(--cairn-error-ink);
	}
	.cm-host {
		padding: 18px var(--pad) 28px;
		cursor: text;
	}
	.loading {
		color: var(--color-muted);
		padding: 0 var(--pad) 28px;
		margin: 0;
	}
	/* CodeMirror builds its own DOM, so its rules are global under this host. */
	.cm-host :global(.cm-editor) {
		background: transparent;
	}
	.cm-host :global(.cm-editor.cm-focused) {
		outline: none;
	}
	.cm-host :global(.cm-scroller) {
		overflow: visible !important;
		font-family: var(--font-body) !important;
		line-height: 1.7;
	}
	.cm-host :global(.cm-content) {
		padding: 0;
		font-size: 1.0625rem;
		line-height: 1.7;
		caret-color: var(--color-primary);
	}
	.cm-host :global(.cm-line) {
		padding: 0 6px;
		margin: 0 -6px;
		border-radius: var(--radius-field);
	}
	.cm-host :global(.cm-gutters) {
		display: none;
	}
	.cm-host :global(.cm-cursor) {
		border-left-color: var(--color-primary) !important;
		border-left-width: 2px !important;
	}
	.cm-host :global(.cm-selectionBackground),
	.cm-host :global(.cm-focused .cm-selectionBackground) {
		background: color-mix(in oklab, var(--color-primary) 22%, transparent) !important;
	}
	.cm-host :global(.cm-h) {
		font-family: var(--font-display);
		font-weight: 500;
	}
	.cm-host :global(.cm-h1) {
		font-size: 1.7em;
		line-height: 1.2;
	}
	.cm-host :global(.cm-h2) {
		font-size: 1.32em;
		line-height: 1.3;
	}
	.cm-host :global(.cm-h3) {
		font-size: 1.12em;
		line-height: 1.35;
	}
	.cm-host :global(.cm-l-h1) {
		padding-top: 4px;
	}
	/* CodeMirror measures a line's or block widget's box without its margins, so a vertical margin
	   would skew its height map and land a click a line below the text clicked; space and rules
	   above go inside the box instead. */
	.cm-host :global(.cm-l-h2) {
		position: relative;
		padding-top: 37px !important;
		border-radius: 0;
	}
	.cm-host :global(.cm-l-h2::before) {
		content: '';
		position: absolute;
		top: 10px;
		inset-inline: 0;
		border-top: 1px dashed var(--rule);
	}
	.cm-host :global(.cm-l-h3) {
		padding-top: 14px !important;
	}
	.cm-host :global(.cm-mark) {
		color: var(--color-muted);
		font-weight: 400;
		font-family: var(--font-body);
		font-size: 0.8em;
	}
	.cm-host :global(:is(.cm-l-h1, .cm-l-h2, .cm-l-h3, .cm-fence) .cm-mark) {
		font-size: 1em;
	}
	.cm-host :global(.cm-dir-label) {
		color: var(--color-muted);
	}
	.cm-host :global(.cm-fence) {
		font-size: 0.85rem;
		color: var(--color-muted);
	}
	.cm-host :global(.cm-in-block) {
		border-left: 2px solid var(--color-base-300);
		padding-left: 12px !important;
		margin-left: 0 !important;
		border-radius: 0;
	}
	.cm-host :global(.cm-front) {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--color-muted);
		line-height: 1.6;
	}
	/*
	 * Highlights are light fills, deepening while their card is current (round 6), each with a 2px
	 * underline in an ink with 3:1 or better against the page. No fill keeps 3:1 against the page and
	 * 4.5:1 for the text over it with room left for a deeper current state (light warning tops out at
	 * 2.50:1; the rest hold both only in a 3.1 to 3.2 sliver), so the underline carries the 3:1 and
	 * the fills keep the text above 10:1. Ink against the page, light then dark: warning 6.24, 11.06;
	 * info 6.85, 10.48; primary 6.76, 8.27.
	 */
	.cm-host :global(:is(.cm-anchor, .cm-cmt)) {
		border-radius: 2px;
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
		transition: background-color var(--motion-quick) var(--motion-ease);
	}
	.cm-host :global(.cm-anchor) {
		background: color-mix(in oklab, var(--color-warning) 18%, transparent);
		text-decoration-color: var(--cairn-warning-ink);
	}
	.cm-host :global(.cm-anchor.info) {
		background: color-mix(in oklab, var(--color-info) 12%, transparent);
		text-decoration-color: var(--cairn-info-ink);
	}
	.cm-host :global(.cm-anchor.cur) {
		background: color-mix(in oklab, var(--color-warning) 34%, transparent);
	}
	.cm-host :global(.cm-anchor.info.cur) {
		background: color-mix(in oklab, var(--color-info) 26%, transparent);
	}
	.cm-host :global(.cm-cmt) {
		background: color-mix(in oklab, var(--color-primary) 14%, transparent);
		text-decoration-color: var(--color-primary);
	}
	.cm-host :global(.cm-cmt.cur) {
		background: color-mix(in oklab, var(--color-primary) 26%, transparent);
	}
	/* The muted syntax markers; on a current highlight's deeper fill they take a darker ink to stay readable. */
	.cm-host :global(.cm-syntax-mark) {
		color: var(--color-muted);
		font-weight: 400;
	}
	.cm-host :global(:is(.cm-cmt, .cm-anchor).cur .cm-syntax-mark),
	.cm-host :global(.cm-syntax-mark :is(.cm-cmt, .cm-anchor).cur) {
		color: color-mix(in oklab, var(--color-muted) 60%, var(--color-base-content));
	}
	.cm-host :global(.cm-gone) {
		position: relative;
		height: 6px;
	}
	.cm-host :global(.cm-gone::before) {
		content: '';
		position: absolute;
		top: 2px;
		inset-inline: 0;
		border-top: 2px dotted color-mix(in oklab, var(--color-primary) 55%, transparent);
	}
	/* The Comment button at a selection, where the margin is a drawer. */
	.cm-host :global(.cm-tooltip.cm-tooltip) {
		z-index: 20;
	}
	.cm-host :global(.cm-tooltip.cm-cbtn),
	.cm-host :global(.cm-tooltip:has(> .cm-cbtn)) {
		border: 0;
		background: transparent;
	}
	.cm-host :global(.cm-cbtn .btn) {
		box-shadow: var(--bar-shadow);
	}
	.cm-host :global(.cm-edited) {
		position: relative;
		box-shadow: inset 3px 0 0 var(--color-primary);
	}
	/* A glyph in the margin as well, so a changed line is not marked by color alone. */
	.cm-host :global(.cm-edited)::before {
		content: '+' / '';
		position: absolute;
		left: -14px;
		top: 0;
		font: 700 0.85rem/1.7 var(--font-mono);
		color: var(--color-primary);
	}
	/* The merge view's folds and changes, on the theme's tokens so dark mode follows, with a left rule and a strikethrough so a removed line is not told from an added one by tint alone. */
	.cm-host :global(.cm-collapsedLines) {
		color: var(--color-muted);
		background: var(--color-base-200);
		border-radius: var(--radius-field);
	}
	.cm-host :global(.cm-collapsedLines:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}
	.cm-host :global(.cm-changedLine) {
		background: color-mix(in oklab, var(--color-success) 10%, var(--color-base-100));
		box-shadow: inset 3px 0 0 var(--color-success);
	}
	.cm-host :global(.cm-deletedChunk) {
		background: color-mix(in oklab, var(--color-error) 10%, var(--color-base-100));
		box-shadow: inset 3px 0 0 var(--color-error);
	}
	.cm-host :global(.cm-deletedChunk .cm-deletedLine) {
		text-decoration: line-through;
	}
	.cm-host :global(.cm-changedText) {
		background: linear-gradient(var(--color-success), var(--color-success)) bottom / 100% 2px no-repeat !important;
	}
	.cm-host :global(.cm-deletedChunk .cm-deletedText) {
		background: linear-gradient(var(--color-error), var(--color-error)) bottom / 100% 2px no-repeat !important;
	}
	.cm-host :global(.cm-link) {
		color: var(--color-primary);
	}
	.cm-host :global(.cm-url) {
		color: var(--color-muted);
		font-size: 0.9em;
	}
	.cm-host :global(.cm-code) {
		font-family: var(--font-mono);
		font-size: 0.86em;
		background: color-mix(in oklab, var(--color-base-300) 55%, transparent);
		border-radius: 3px;
		padding: 0 0.2em;
	}
	@media (max-width: 639.98px) {
		.cm-host :global(.cm-scroller),
		.cm-host :global(.cm-content) {
			line-height: 1.55;
		}
	}
</style>
