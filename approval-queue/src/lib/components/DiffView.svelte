<!-- @component
A file's diff in the snapshot, or a link to the pull request's Files tab when the file changes more than
`MAX_CHANGED` lines. `file` is undefined for a path the snapshot does not hold (a binary or renamed
file), which reads as a link too.
-->
<script lang="ts">
	import type { DiffFile } from '#lib/diff.ts';
	import { changedLines, githubFiles, MAX_CHANGED } from '#lib/packet-view.ts';
	import DiffTable from './DiffTable.svelte';

	let { file, pr, path, all = false }: { file: DiffFile | undefined; pr: string; path: string; all?: boolean } = $props();
	const big = $derived(file !== undefined && changedLines(file) > MAX_CHANGED);
</script>

{#if file && !big}
	<div class="diffbox"><DiffTable {file} {pr} /></div>
{:else}
	<p class="muted">
		{#if big}<code>{path}</code> changes {changedLines(file!)} lines, more than the {MAX_CHANGED} this page shows.{:else}The snapshot holds no text diff for <code>{path}</code>.{/if}
		<a class="link" href={githubFiles(pr)} target="_blank" rel="noreferrer">Open the {all ? 'file' : 'change'} on GitHub</a>.
	</p>
{/if}

<style>
	.diffbox {
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-field);
		background: var(--site-field-bg);
		overflow-x: auto;
		margin: 4px 0 8px;
	}
	.muted {
		color: var(--color-muted);
		font-size: 0.9rem;
	}
</style>
