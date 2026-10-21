<!-- @component
A markdown document under review, in a CodeMirror 6 editor with its notes inline: the file name and
save state in a bar above, the source styled the way cairn's admin editor styles it, and each note
under the line its anchor names. The editor is built on mount, so the server render shows the
loading line; until then, and if scripts fail, nothing is editable.

All state lives in the `DocReview` it is handed, which the review pane and the decision bar read
too: whether the text takes edits and whether the calls are frozen come from it. Edits save through
that review; this component only shows the result. Leaving with an edit not yet saved sends it on
the way out, so a quick navigation never drops the last words typed.
-->
<script lang="ts">
	import type { EditorView } from '@codemirror/view';
	import { onMount } from 'svelte';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import { createEditor, setLocked, setMarkChanges, setReadonly } from '#lib/editor/setup.ts';

	interface Props {
		review: DocReview;
		/** The file name the bar shows, such as `debug-your-site.blueprint.md`. */
		file: string;
		/** The editable region's accessible name; it names the file, since a screen can hold several. */
		label: string;
		/** A YAML file, set in the monospace face with each wrapped line hanging at its indentation. */
		yaml?: boolean;
	}

	let { review, file, label, yaml = false }: Props = $props();

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
			readonly: review.readonly,
			locked: review.locked,
			yaml,
			hooks: review.hooks
		});
		review.attach(v);
		view = v;
		const track = () => review.track();
		window.addEventListener('scroll', track, { passive: true });
		track();
		return () => {
			window.removeEventListener('scroll', track);
			if (review.pending) void review.flush();
			review.attach(null);
			v.destroy();
		};
	});

	$effect(() => {
		if (view) setReadonly(view, review.readonly);
	});

	$effect(() => {
		if (view) setLocked(view, review.locked);
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
		<!-- Not a live region: the review announces the first save and any failure, not every pause in typing. -->
		<span class={['esaved', review.saveFailed && 'failed']}>{review.saveStatus}</span>
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions: the padding forwards a pointer press to the editor, which has its own keyboard focus -->
	<div class={['cm-host', yaml && 'yaml']} bind:this={host} onmousedown={focusFromPadding}></div>
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
	.cm-host.yaml :global(.cm-scroller),
	.cm-host.yaml :global(.cm-content) {
		font-family: var(--font-mono) !important;
		font-size: 0.8rem;
		line-height: 1.6;
	}
	.cm-host.yaml :global(.cm-yaml) {
		padding-left: calc(var(--hang) + 6px);
		text-indent: calc(-1 * var(--hang));
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
