<!-- @component
A PR: four figures, its checks and review, the body in collapsible sections, then the changed files
grouped by top-level directory with a path filter and each diff opened in place. Color marks only
a failing check, a blocking verdict, and the diff signs; each also says so in words.
-->
<script lang="ts">
	import { desk } from '#lib/desk.svelte.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';

	let { data }: { data: Extract<PageData, { kind: 'pr' }> } = $props();

	const VERDICTS = { accept: 'Accepted', fix: 'Fix', escalate: 'Escalate' };
	const CHECK_NOTES = { pass: '', fail: 'failed', skip: 'skipped', pending: 'pending' };
	const count = (n: number) => n.toLocaleString('en-US');
	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

	let term = $state('');
	let filter: HTMLInputElement | undefined;
	let groupOpen = $state<Record<string, boolean>>({});

	const needle = $derived(term.trim().toLowerCase());
	const shown = $derived(
		data.groups
			.map((g) => ({ ...g, files: needle ? g.files.filter((f) => f.path.toLowerCase().includes(needle)) : g.files }))
			.filter((g) => g.files.length)
	);
	const matches = $derived(shown.reduce((n, g) => n + g.files.length, 0));
	const summary = $derived(
		needle
			? `${matches} ${plural(matches, 'match', 'matches')} in ${shown.length} ${plural(shown.length, 'group', 'groups')}`
			: `${data.totals.files} in ${data.groups.length} ${plural(data.groups.length, 'group', 'groups')}`
	);
	const allOpen = $derived(shown.every((g) => groupOpen[g.name]));
	const reviewFails = $derived(data.verdict === 'fix' || data.verdict === 'escalate');

	$effect(() => {
		desk.handlers = { ...desk.handlers, 'focus-filter': () => filter?.focus() };
	});

	function toggleAll() {
		for (const g of shown) groupOpen[g.name] = !allOpen;
	}

	function onFilterKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		term = '';
		filter?.blur();
	}

	function split(path: string) {
		const at = path.lastIndexOf('/') + 1;
		return [path.slice(0, at), path.slice(at)];
	}
</script>

<div class="stats desk-glance mt-1" role="group" aria-label="PR at a glance">
	<div class="stat">
		<div class="stat-title">Risk</div>
		<div class="stat-value">{data.risk ?? 'Not stated'}</div>
	</div>
	<a class="stat" href="#checks">
		<div class="stat-title">Checks</div>
		<div class="stat-value" class:desk-fail={data.checks.failed > 0}>{data.checks.text}</div>
	</a>
	<a class="stat" href="#verdicts">
		<div class="stat-title">Review</div>
		<div class="stat-value" class:desk-fail={reviewFails}>
			{data.verdict ? VERDICTS[data.verdict] : 'Not stated'}
		</div>
	</a>
	<a class="stat" href="#files">
		<div class="stat-title">Changes</div>
		<div class="stat-value">
			{count(data.totals.files)} {plural(data.totals.files, 'file', 'files')}
			<span class="desk-add">+{count(data.totals.adds)}</span>
			<span class="desk-del">−{count(data.totals.dels)}</span>
		</div>
	</a>
</div>

<div class="mt-7 grid gap-x-12 gap-y-7 xl:grid-cols-2">
	<section id="checks" aria-labelledby="checks-h">
		<h2 id="checks-h" class="text-sm font-semibold">
			Checks
			<span class="desk-muted font-normal">
				{data.checks.text}{data.meta.head ? `, on ${data.meta.head.slice(0, 8)}` : ''}
			</span>
		</h2>
		{#if data.checks.rows.length}
			<ul class="desk-muted mt-1.5 grid gap-x-6 text-[0.84rem] sm:grid-cols-2">
				{#each data.checks.rows as row, i (i)}
					<li class="flex min-w-0 items-center gap-2 py-0.5" class:desk-fail={row.state === 'fail'}>
						<span class="truncate">{row.name}</span>
						{#if CHECK_NOTES[row.state]}<span class="ml-auto shrink-0">{CHECK_NOTES[row.state]}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
	<section id="verdicts" aria-labelledby="verdicts-h">
		<h2 id="verdicts-h" class="text-sm font-semibold">
			Review
			<span class="desk-muted font-normal">{data.verdict ? VERDICTS[data.verdict].toLowerCase() : 'not stated'}</span>
		</h2>
		{#if data.reviewHtml}
			<div class="desk-md mt-1" class:desk-fail={reviewFails}>{@html data.reviewHtml}</div>
		{/if}
	</section>
</div>

<section class="mt-8" aria-labelledby="desc-h">
	<h2 id="desc-h" class="text-base font-semibold">Description</h2>
	<div class="desk-md mt-1">{@html data.leadHtml}</div>
	<div class="desk-plain-list mt-3">
		{#each data.sections as section, i (i)}
			<details
				class="collapse collapse-arrow desk-collapse rounded-none border-t border-base-300"
				open={section.title.toLowerCase() === 'what landed'}
			>
				<summary class="collapse-title text-sm">{section.title}</summary>
				<div class="collapse-content"><div class="desk-md px-3 pb-3">{@html section.html}</div></div>
			</details>
		{/each}
	</div>
</section>

<section id="files" class="mt-8" aria-labelledby="files-h">
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<h2 id="files-h" class="text-base font-semibold">Files</h2>
		<span class="desk-muted -ml-2 text-base" role="status">{summary}</span>
		<label class="input input-sm ml-auto w-full sm:w-72">
			<svg class="h-4 w-4 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<circle cx="11" cy="11" r="7" />
				<path d="m20 20-3.5-3.5" />
			</svg>
			<input
				type="search"
				class="grow"
				placeholder="Filter by path"
				aria-label="Filter files by path"
				bind:this={filter}
				bind:value={term}
				onkeydown={onFilterKey}
			/>
			<kbd class="kbd kbd-xs desk-kbd desk-sk">/</kbd>
		</label>
		<button type="button" class="btn btn-sm btn-ghost" onclick={toggleAll}>
			{allOpen ? 'Close all groups' : 'Open all groups'}
		</button>
	</div>
	<div class="mt-2">
		{#each shown as group (group.name)}
			{@const adds = group.files.reduce((n, f) => n + f.adds, 0)}
			{@const dels = group.files.reduce((n, f) => n + f.dels, 0)}
			<details
				class="collapse collapse-arrow desk-collapse rounded-none border-t border-base-300"
				open={needle !== '' || groupOpen[group.name]}
				ontoggle={(e) => {
					if (!needle) groupOpen[group.name] = e.currentTarget.open;
				}}
			>
				<summary class="collapse-title">
					<span class="font-mono text-[0.85rem] font-semibold">{group.name === 'Repository root' ? group.name : `${group.name}/`}</span>
					<span class="desk-muted text-sm">
						{needle ? `${group.files.length} of ${data.groups.find((g) => g.name === group.name)?.files.length} files` : `${group.files.length} ${plural(group.files.length, 'file', 'files')}`}
					</span>
					<span class="ml-auto flex shrink-0 items-center gap-3 text-[0.8rem] tabular-nums">
						<span class="desk-add">+{count(adds)}</span>
						<span class="desk-del">−{count(dels)}</span>
					</span>
				</summary>
				<div class="collapse-content">
					<ul class="pl-4">
						{#each group.files as file (file.path)}
							{@const [dir, name] = split(file.path)}
							<li>
								<details class="collapse collapse-arrow desk-collapse rounded-none border-t border-base-300">
									<summary class="collapse-title text-sm">
										<span class="min-w-0 truncate font-mono text-[0.8rem]"><span class="desk-muted">{dir}</span>{name}</span>
										{#if file.status === 'new'}
											<span class="badge badge-xs badge-outline desk-add shrink-0">new</span>
										{:else if file.status === 'deleted'}
											<span class="badge badge-xs badge-outline desk-del shrink-0">deleted</span>
										{/if}
										<span class="ml-auto shrink-0 text-[0.8rem] tabular-nums">+{file.adds} −{file.dels}</span>
									</summary>
									<div class="collapse-content">
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
									</div>
								</details>
							</li>
						{/each}
					</ul>
				</div>
			</details>
		{/each}
	</div>
	{#if shown.length === 0}
		<p class="desk-muted mt-2 text-sm" role="status">No file path matches that filter.</p>
	{/if}
</section>

<style>
	.desk-glance {
		display: flex;
		flex-wrap: wrap;
		row-gap: 0.75rem;
		background: transparent;
		overflow: visible;
	}
	.desk-glance .stat {
		width: auto;
		border: 0;
		padding: 0 44px 0 0;
		row-gap: 2px;
	}
	.desk-glance .stat-title {
		color: var(--color-muted);
		font-size: 0.8rem;
	}
	.desk-glance .stat-value {
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.4;
	}
	.desk-add {
		color: var(--cairn-success-ink);
	}
	.desk-del {
		color: var(--cairn-error-ink);
	}
	.desk-fail {
		color: var(--cairn-error-ink);
	}
	.desk-plain-list > :global(* + *) {
		border-top: 1px solid var(--color-base-300);
	}

	.desk-collapse > :global(.collapse-title) {
		min-height: 2.25rem;
		padding-block: 6px;
		padding-inline: 12px 40px;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.desk-collapse.collapse-arrow > :global(.collapse-title)::after {
		top: 50%;
		inset-inline-end: 18px;
	}
	.desk-collapse > :global(.collapse-content) {
		padding-inline: 0;
	}
	.desk-collapse[open] > :global(.collapse-content),
	.desk-collapse:focus-within > :global(.collapse-content) {
		padding-bottom: 0;
	}
	.desk-collapse > :global(.collapse-title:hover) {
		background-color: var(--color-base-200);
	}

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

	.desk-md {
		font-size: 0.9rem;
		line-height: 1.62;
	}
	.desk-md > :global(:first-child) {
		margin-top: 0;
	}
	.desk-md :global(h2) {
		font-weight: 700;
		font-size: 0.95rem;
		margin: 1rem 0 0.35rem;
	}
	.desk-md :global(h3) {
		font-weight: 700;
		font-size: 0.9rem;
		margin: 0.8rem 0 0.3rem;
	}
	.desk-md :global(p),
	.desk-md :global(ul),
	.desk-md :global(ol),
	.desk-md :global(table) {
		margin: 0.45rem 0;
	}
	.desk-md :global(p),
	.desk-md :global(li) {
		max-width: 72ch;
	}
	.desk-md :global(ul) {
		list-style: disc;
		padding-inline-start: 1.25rem;
	}
	.desk-md :global(ol) {
		list-style: decimal;
		padding-inline-start: 1.25rem;
	}
	.desk-md :global(li + li) {
		margin-top: 0.2rem;
	}
	.desk-md :global(strong) {
		font-weight: 700;
	}
	.desk-md :global(a) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.desk-md :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
		background: var(--color-base-200);
		padding: 1px 4px;
		border-radius: 3px;
		overflow-wrap: anywhere;
	}
	.desk-md :global(pre) {
		overflow-x: auto;
	}
	.desk-md :global(table) {
		border-collapse: collapse;
		font-size: 0.84rem;
		width: 100%;
	}
	.desk-md :global(th),
	.desk-md :global(td) {
		border-bottom: 1px solid var(--color-base-300);
		padding: 4px 10px 4px 0;
		text-align: left;
		vertical-align: top;
	}
	.desk-md :global(th) {
		font-weight: 600;
		color: var(--color-muted);
	}
</style>
