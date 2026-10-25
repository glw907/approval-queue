<!-- @component
A PR's work in the order its reader needs it, under the frame's Survey header: what changes, what
approving does, and one footnote, the "Decide first" cards, the brief's detail rows, then the
evidence rows.
Color marks only the must-act note rules and the diff signs.

`picks` passes through to `DecideCards` and is bound up to the panel so its bar can unlock Approve.
A PR whose body has no brief shows its title and the rows it still has.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import BriefBlock from './BriefBlock.svelte';
	import DecideCards from './DecideCards.svelte';
	import DetailRows from './DetailRows.svelte';
	import DiffTable from './DiffTable.svelte';
	import Disclosure from './Disclosure.svelte';

	interface Props {
		data: Extract<PageData, { kind: 'pr' }>;
		/** The chosen choice index for each card, or undefined while it has none. */
		picks: Array<number | undefined>;
	}

	let { data, picks = $bindable([]) }: Props = $props();

	const VERDICTS = { accept: 'Accepted', fix: 'Fix', escalate: 'Escalate' };
	const CHECK_NOTES = { pass: '', fail: 'failed', skip: 'skipped', pending: 'pending' };
	const count = (n: number) => n.toLocaleString('en-US');
	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

	let term = $state('');
	let filter: HTMLInputElement | undefined;
	let filesOpen = $state(false);
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
	const checksTotal = $derived(data.checks.rows.length);
	const checksSummaryText = $derived(
		checksTotal === 0
			? 'No checks.'
			: data.checks.failed > 0
				? `${data.checks.failed} of ${checksTotal} failed.`
				: data.checks.pending > 0
					? `${data.checks.pending} of ${checksTotal} pending.`
					: `All ${data.checks.passed} passed.`
	);
	const reviewSummary = $derived(
		data.verdict ? `${VERDICTS[data.verdict]}.` : data.reviewHtml === null ? 'None run.' : 'Not stated.'
	);
	const filesSummary = $derived(
		`${data.totals.files} ${plural(data.totals.files, 'file', 'files')}, +${count(data.totals.adds)} −${count(data.totals.dels)}.`
	);

	$effect(() =>
		desk.register({
			'focus-filter': async () => {
				filesOpen = true;
				await tick();
				filter?.focus();
			}
		})
	);

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

<BriefBlock whatChanges={data.whatChanges} ifYouApprove={data.ifYouApprove} worthKnowing={data.worthKnowing} />

<DecideCards cards={data.cards} bind:picks decided={data.decided} />

<DetailRows details={data.details} />

<section class="sec" id="evidence" aria-labelledby="evidence-h">
	<h2 id="evidence-h">Evidence</h2>
	<p class="sl">Closed by default; each row says where it stands.</p>
	<Disclosure name="Checks" summaryHtml={checksSummaryText} wide>
		{#if data.checks.rows.length}
			<ul class="grid gap-x-6 text-[0.84rem] sm:grid-cols-2">
				{#each data.checks.rows as row, i (i)}
					<li class="flex min-w-0 items-center gap-2 py-0.5" class:desk-fail={row.state === 'fail'}>
						<span class="truncate">{row.name}</span>
						{#if CHECK_NOTES[row.state]}<span class="ml-auto shrink-0">{CHECK_NOTES[row.state]}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Disclosure>
	<Disclosure name="Review" summaryHtml={reviewSummary}>
		{#if data.reviewHtml}<div class="desk-md">{@html data.reviewHtml}</div>{/if}
	</Disclosure>
	{#if data.technicalHtml}
		<Disclosure name="Technical notes" summaryHtml="What landed and the gate.">
			<div class="desk-md">{@html data.technicalHtml}</div>
		</Disclosure>
	{/if}
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
</section>

<style>
	.desk-add {
		color: var(--cairn-success-ink);
	}
	.desk-del {
		color: var(--cairn-error-ink);
	}
	.desk-fail {
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
		max-width: 56ch;
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
