<!-- @component
One file's unified diff as a table: old and new line numbers, a sign, and the line. Lines wrap
rather than scroll, so the table never widens the page. It matches the PR screen's Files rows.
-->
<script lang="ts">
	import type { DiffFile } from '#lib/diff.ts';

	let { file }: { file: DiffFile } = $props();
</script>

<table class="desk-diff" aria-label="Diff of {file.path}">
	<tbody>
		{#each file.rows as row, i (i)}
			<tr class={row.kind}>
				<td class="ln">{row.kind === 'add' || row.kind === 'hunk' ? '' : (row.oldLine ?? '')}</td>
				<td class="ln">{row.kind === 'del' || row.kind === 'hunk' ? '' : (row.newLine ?? '')}</td>
				<td class="sg">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</td>
				<td class="cd">{row.text}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.desk-diff {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: 0.76rem;
		line-height: 1.55;
	}
	.desk-diff td {
		padding: 0;
		vertical-align: top;
	}
	.desk-diff .ln {
		width: 1%;
		min-width: 3.2em;
		padding-inline: 8px;
		text-align: right;
		white-space: nowrap;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		user-select: none;
		border-inline-end: 1px solid var(--color-base-300);
	}
	.desk-diff .sg {
		width: 1.4em;
		text-align: center;
		user-select: none;
	}
	.desk-diff .cd {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding-inline-end: 12px;
	}
	.desk-diff tr.add td {
		background-color: color-mix(in oklab, var(--color-success) 13%, var(--color-base-100));
	}
	.desk-diff tr.add .sg {
		color: var(--cairn-success-ink);
		font-weight: 700;
	}
	.desk-diff tr.del td {
		background-color: color-mix(in oklab, var(--color-error) 11%, var(--color-base-100));
	}
	.desk-diff tr.del .sg {
		color: var(--cairn-error-ink);
		font-weight: 700;
	}
	.desk-diff tr.hunk td {
		background-color: var(--color-base-200);
		color: var(--cairn-info-ink);
		padding-block: 2px;
	}
</style>
