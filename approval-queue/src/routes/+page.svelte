<!-- @component
The home page: the board of waiting packets under their initiatives, or the empty state when
nothing waits. The sort comes from the server's cookie read, so the first render is already in
order; picking a sort writes the cookie and reorders here, and the 2-second poll refreshes the
rows without moving the reader. Row links replace the history entry, so the empty state's
`window.close()` keeps working. Each row's one link stretches over the row, so a row is one tab
stop and the whole row is the target; it carries `data-q`, so j and k walk the rows, and its
description is the row's meta line, then the orphan line when no session waits. An item whose decision `held` is counting down or posting
is left off, and the empty state shows once nothing else waits. A deferred row sits under
"Deferred"; an orphaned row says no session is waiting for its answer.
-->
<script lang="ts">
	import { age, boardGroups, SORT_COOKIE, type Sort } from '#lib/board.ts';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PacketIcon from '#lib/components/PacketIcon.svelte';
	import { held } from '#lib/held.svelte.ts';

	let { data } = $props();

	let picked = $state<Sort | null>(null);
	const rows = $derived(data.empty ? [] : data.rows.filter((row) => !held.ids.has(row.id)));
	const empty = $derived(rows.length === 0);
	const sort = $derived<Sort>(picked ?? (data.empty ? 'asks' : data.sort));
	const groups = $derived(boardGroups(rows, sort));
	const total = $derived(rows.reduce((n, r) => n + r.asks, 0));

	function pick(next: Sort) {
		picked = next;
		document.cookie = `${SORT_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
	}

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const scent = (row: { asks: number; rules: string[]; repos: number; single?: string }) =>
		row.single
			? row.single
			: [
					row.asks ? row.rules.map((rule) => rule.replaceAll('-', ' ')).join(', ') : 'routine only',
					plural(row.repos, 'repo')
				].join(' · ');
</script>

<svelte:head>
	{#if !empty}<title>Waiting for you · Approval Queue</title>{/if}
</svelte:head>

{#if empty}
	<EmptyState />
{:else}
	<main id="main" tabindex="-1" class="flex-1 px-5 pt-6 pb-8 lg:px-12">
		<div class="max-w-4xl">
			<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div>
					<h1 class="desk-title text-[1.75rem] leading-tight">Waiting for you</h1>
					<p class="desk-muted mt-1">
						<span class="tabular-nums">{plural(rows.length, 'item')}</span>,
						<span class="tabular-nums">{plural(total, 'ask')}</span>. The order changes only when you pick a sort.
					</p>
				</div>
				<div class="flex items-center gap-3">
					<span id="sort-label" class="text-sm font-semibold">Sort</span>
					<div class="join sort-seg rounded-field border border-base-300 bg-base-100" role="radiogroup" aria-labelledby="sort-label">
						<input
							type="radio"
							name="sort"
							class="join-item btn btn-sm"
							aria-label="Asks first"
							checked={sort === 'asks'}
							onchange={() => pick('asks')}
						/>
						<input
							type="radio"
							name="sort"
							class="join-item btn btn-sm"
							aria-label="Oldest first"
							checked={sort === 'oldest'}
							onchange={() => pick('oldest')}
						/>
					</div>
				</div>
			</div>
			<div class="mt-4">
				<!-- svelte-ignore a11y_no_redundant_roles: the phone layout sets display:block, which drops table semantics in some browsers, so the roles restore them -->
				<table class="table board-table" role="table">
					<caption class="sr-only">Packets and items waiting for you, grouped by initiative</caption>
					<!-- svelte-ignore a11y_no_redundant_roles: the phone layout sets display:block, which drops table semantics in some browsers, so the roles restore them -->
					<thead role="rowgroup">
						<!-- svelte-ignore a11y_no_redundant_roles: the phone layout sets display:block, which drops table semantics in some browsers, so the roles restore them -->
						<tr role="row">
							<th role="columnheader" scope="col" class="init-col">Initiative</th>
							<th role="columnheader" scope="col">Packet</th>
							<th role="columnheader" scope="col" class="num">Asks</th>
							<th role="columnheader" scope="col" class="num">Waiting</th>
						</tr>
					</thead>
					{#each groups as group (group.title)}
						<!-- svelte-ignore a11y_no_redundant_roles: the phone layout sets display:block, which drops table semantics in some browsers, so the roles restore them -->
						<tbody role="rowgroup">
							{#each group.rows as row, i (row.id)}
								<!-- svelte-ignore a11y_no_redundant_roles: the phone layout sets display:block, which drops table semantics in some browsers, so the roles restore them -->
								<tr role="row" class="board-row">
									<th role="rowheader" scope="row" class="init-cell align-top">
										{#if i === 0}{group.title}{:else}<span class="sr-only">{group.title}</span>{/if}
									</th>
									<td role="cell" class="align-top">
										<a
											class="board-link font-medium"
											href="/item/{row.id}"
											data-q
											data-sveltekit-replacestate
											aria-describedby={row.orphaned ? `meta-${row.id} orphan-${row.id}` : `meta-${row.id}`}
										>
											{row.headline}
										</a>
										<div id="meta-{row.id}" class="desk-muted mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8rem]">
											{#if row.irreversible}
												<span class="tone-error inline-flex items-center gap-1 font-semibold">
													<PacketIcon name="lock" class="size-3.5" />Irreversible
												</span>
												<span aria-hidden="true">&middot;</span>
											{/if}
											<span>{scent(row)}</span>
										</div>
										{#if row.orphaned}
											<p id="orphan-{row.id}" class="desk-muted mt-0.5 text-[0.8rem]">No session is waiting for this.</p>
										{/if}
									</td>
									<td role="cell" class="num align-top">
										{#if row.single}<span class="desk-muted" aria-hidden="true">&ndash;</span><span class="sr-only">No asks</span>{:else}<span class={row.asks ? 'font-semibold' : 'desk-muted'}>{row.asks}</span>{/if}
									</td>
									<td role="cell" class="num align-top"><time datetime={row.created}>{age(row.created)}</time></td>
								</tr>
							{/each}
						</tbody>
					{/each}
				</table>
			</div>
		</div>
	</main>
{/if}

<style>
	.board-table {
		font-size: 1rem;
	}
	.board-table th,
	.board-table td {
		padding-block: 6px;
	}
	.board-table thead th {
		color: var(--color-muted);
		font-size: 0.875rem;
		font-weight: 600;
	}
	/* The selected sort is near-black, as the prototype sets it, where the stock checked state takes the primary blue. */
	.sort-seg .btn:checked {
		--btn-color: var(--color-base-content);
		--btn-fg: var(--color-base-100);
	}
	.init-col {
		width: 11rem;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		width: 5rem;
	}
	.init-cell {
		color: var(--color-base-content);
		font-weight: 600;
	}
	.board-row {
		position: relative;
	}
	.board-row:hover {
		background-color: var(--color-base-200);
	}
	/* The link stretches over its row: the whole row is the target and takes the focus ring. */
	.board-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.board-link:focus-visible {
		outline: none;
	}
	.board-link:focus-visible::after {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
		border-radius: var(--radius-field);
	}
	.board-link:hover {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	/* A heavier rule between initiatives than between rows, at the 3:1 field-border token. */
	.board-table tbody + tbody > tr:first-child > :global(*) {
		border-top: 2px solid var(--site-field-border);
	}

	/* Phone: the initiative takes its own line above its first row. */
	@media (max-width: 639.98px) {
		.board-table,
		.board-table thead,
		.board-table tbody {
			display: block;
		}
		.init-col {
			display: none;
		}
		.board-table thead tr,
		.board-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 3rem 4.5rem;
			column-gap: 8px;
			align-items: start;
		}
		.board-table th,
		.board-table td {
			padding-inline: 0;
			border-bottom: 0;
		}
		.board-table thead tr,
		.board-table tbody tr:not(:last-child) {
			border-bottom: 1px solid color-mix(in oklab, var(--color-base-content) 5%, transparent);
		}
		.num {
			width: auto;
		}
		.board-row > .init-cell {
			grid-column: 1 / -1;
			padding-block: 8px 0;
		}
		.board-row > .init-cell:has(.sr-only) {
			padding: 0;
		}
		.board-row > td {
			padding-top: 4px;
		}
		.board-table tbody + tbody > tr:first-child > :global(td) {
			border-top: 0;
		}
		.board-table tbody + tbody > tr:first-child > :global(.init-cell) {
			padding-top: 12px;
		}
	}
</style>
