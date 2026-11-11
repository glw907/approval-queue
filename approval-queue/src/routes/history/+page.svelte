<!-- @component
History: every decided item, newest first, with a search over titles (a plain GET form, so the
address holds the query). Each row opens at `/item/<id>` as it was decided; an item stored in an old
shape opens read-only there. A row counts its notes and the replies to them, and says nothing of a
sidecar that could not be read.
-->
<script lang="ts">
	import { decisionWord, longDay } from '#lib/board.ts';

	let { data } = $props();

	const KINDS: Record<string, string> = { packet: 'Packet', design: 'Design', triage: 'Triage list' };
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	/** The line under a title: kind, decision, date, then the notes and replies when there are any. */
	const sub = (row: (typeof data.rows)[number]) =>
		[
			KINDS[row.kind] ?? (row.kind ? row.kind.charAt(0).toUpperCase() + row.kind.slice(1) : 'Item'),
			decisionWord(row.decision),
			longDay(row.date),
			row.notes ? plural(row.notes, 'note') : '',
			row.replies ? plural(row.replies, 'reply').replace('replys', 'replies') : ''
		]
			.filter(Boolean)
			.join(', ');
</script>

<svelte:head><title>History · Approval Queue</title></svelte:head>

<div class="packet">
	<main id="main" tabindex="-1" class="packet-main">
		<div class="packet-body">
			<h1 class="head"><i class="benchmark"></i>History</h1>
			<div class="prose">
				<p>Decided packets live here, newest first, with search. Each opens as it was when you decided, with your notes and the session’s reply to each.</p>
			</div>
			<form method="GET" role="search" class="search">
				<label class="input">
					<span class="sr-only">Search titles</span>
					<input type="search" name="q" value={data.q} placeholder="Search titles" />
				</label>
				<button type="submit" class="btn btn-sm btn-outline">Search</button>
			</form>
			{#if data.rows.length}
				<ul class="list" aria-label="Decided items">
					{#each data.rows as row (row.id)}
						<li class="list-row">
							<a class="list-col-grow" href="/item/{encodeURIComponent(row.id)}">
								<span class="title">{row.title}</span>
								<span class="sub">{sub(row)}</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">{data.q ? `Nothing decided has “${data.q}” in its title.` : 'Nothing has been decided yet.'}</p>
			{/if}
		</div>
	</main>

	<aside class="margin" aria-label="Notes">
		<h2>Your notes</h2>
		<p class="hint">Each decided packet keeps its notes and the session’s reply to each. Open one to read them.</p>
	</aside>
</div>

<style>
	.search {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 14px;
		max-width: 41rem;
	}
	.search .input {
		flex: 1;
	}
	.list-row {
		padding-inline: 0;
	}
	.list-row a {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	.title {
		display: block;
		font: 400 1.05rem/1.5 var(--font-display);
	}
	.sub {
		display: block;
		font-size: 0.86rem;
		color: var(--color-muted);
	}
	.list a:hover .title {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
