<!-- @component
A markdown document under review, in a CodeMirror 6 editor with its notes inline: the file name and
save state in a bar above, the source styled the way cairn's admin editor styles it, and each note
under the line its anchor names. The editor is built on mount, so the server render shows the
loading line; until then, and if scripts fail, nothing is editable.

All state lives in the `DocReview` it is handed, which the review pane and the decision bar read
too. Edits save through that review; this component only shows the result.
-->
<script lang="ts">
	import type { EditorView } from '@codemirror/view';
	import { onMount } from 'svelte';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import { createEditor, setMarkChanges, setReadonly } from '#lib/editor/setup.ts';

	interface Props {
		review: DocReview;
		/** The file name the bar shows, such as `debug-your-site.blueprint.md`. */
		file: string;
		/** The editable region's accessible name. */
		label: string;
		/** No edits are taken, as while a decision is held or once the item is decided. */
		readonly?: boolean;
	}

	let { review, file, label, readonly = false }: Props = $props();

	let host = $state<HTMLDivElement>();
	let view = $state<EditorView | null>(null);

	onMount(() => {
		if (!host) return;
		const v = createEditor(host, {
			doc: review.text,
			notes: review.notes,
			original: review.original,
			label,
			decided: $state.snapshot(review.decided),
			readonly,
			hooks: review.hooks
		});
		review.attach(v);
		view = v;
		const track = () => review.track();
		window.addEventListener('scroll', track, { passive: true });
		track();
		return () => {
			window.removeEventListener('scroll', track);
			review.attach(null);
			v.destroy();
		};
	});

	$effect(() => {
		if (view) setReadonly(view, readonly);
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
</script>

<div class="edwrap">
	<div class="edbar">
		<span class="fname">{file}</span>
		<span class={['esaved', review.saveFailed && 'failed']} role="status" aria-live="polite">{review.saveStatus}</span>
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cm-host" bind:this={host} onmousedown={focusFromPadding}></div>
	{#if !view}<p class="loading">Loading the editor…</p>{/if}
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
	.esaved {
		margin-left: auto;
		text-align: right;
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
	.cm-host :global(.cm-l-h2) {
		padding-top: 26px !important;
		border-top: 1px dashed var(--rule);
		margin-top: 10px;
		border-radius: 0;
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
	.cm-host :global(.cm-purpose) {
		color: var(--color-muted);
	}
	.cm-host :global(.cm-fact) {
		font-family: var(--font-mono);
		font-size: 0.72em;
		color: var(--color-muted);
		opacity: 0.9;
		white-space: nowrap;
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
	.cm-host :global(.cm-anchor) {
		background: color-mix(in oklab, var(--color-warning) 18%, transparent);
		border-radius: 2px;
	}
	.cm-host :global(.cm-anchor.info) {
		background: color-mix(in oklab, var(--color-info) 12%, transparent);
	}
	.cm-host :global(.cm-edited) {
		box-shadow: inset 3px 0 0 var(--color-primary);
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
	.cm-host :global(.notewidget) {
		padding: 6px 0 10px;
	}
	@media (max-width: 639.98px) {
		.cm-host :global(.cm-scroller),
		.cm-host :global(.cm-content) {
			line-height: 1.55;
		}
	}
</style>
