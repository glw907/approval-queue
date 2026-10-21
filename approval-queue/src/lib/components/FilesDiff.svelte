<!-- @component
The code diff of a PR as the PR screen's Files row shows it: a filter on the path, groups by top
folder, and each file's diff behind its own row, all closed until opened. `groups` and `totals`
come from the item's `load`; a filter that matches nothing says so. Registers the `/` key to focus
the filter for as long as it is mounted.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import type { DiffFile } from '#lib/diff.ts';
	import DiffTable from './DiffTable.svelte';
	import Disclosure from './Disclosure.svelte';

	interface Props {
		groups: Array<{ name: string; files: DiffFile[] }>;
		totals: { files: number; adds: number; dels: number };
	}

	let { groups, totals }: Props = $props();

	const count = (n: number) => n.toLocaleString('en-US');
	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

	let term = $state('');
	let filter: HTMLInputElement | undefined;
	let filesOpen = $state(false);
	let groupOpen = $state<Record<string, boolean>>({});

	const needle = $derived(term.trim().toLowerCase());
	const shown = $derived(
		groups
			.map((g) => ({ ...g, files: needle ? g.files.filter((f) => f.path.toLowerCase().includes(needle)) : g.files }))
			.filter((g) => g.files.length)
	);
	const matches = $derived(shown.reduce((n, g) => n + g.files.length, 0));
	const summary = $derived(
		needle
			? `${matches} ${plural(matches, 'match', 'matches')} in ${shown.length} ${plural(shown.length, 'group', 'groups')}`
			: `${totals.files} in ${groups.length} ${plural(groups.length, 'group', 'groups')}`
	);
	const allOpen = $derived(shown.every((g) => groupOpen[g.name]));
	const filesSummary = $derived(
		`${totals.files} ${plural(totals.files, 'file', 'files')}, +${count(totals.adds)} −${count(totals.dels)}.`
	);

	$effect(() => {
		desk.handlers = {
			...desk.handlers,
			'focus-filter': async () => {
				filesOpen = true;
				await tick();
				filter?.focus();
			}
		};
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

<Disclosure name="Files" summaryHtml={filesSummary} wide bind:open={filesOpen}>
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<span class="text-sm text-(--color-muted)" role="status">{summary}</span>
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
						{needle
							? `${group.files.length} of ${groups.find((g) => g.name === group.name)?.files.length} files`
							: `${group.files.length} ${plural(group.files.length, 'file', 'files')}`}
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
										<span class="ml-auto flex shrink-0 items-center gap-3 text-[0.8rem] tabular-nums">
											<span class="desk-add">+{file.adds}</span>
											<span class="desk-del">−{file.dels}</span>
										</span>
									</summary>
									<div class="collapse-content">
										<DiffTable {file} />
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
		<p class="desk-muted mt-2 text-sm">No file path matches that filter.</p>
	{/if}
</Disclosure>

<style>
	.desk-add {
		color: var(--cairn-success-ink);
	}
	.desk-del {
		color: var(--cairn-error-ink);
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
</style>
