<script lang="ts">
	import '../app.css';
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Menu from '@lucide/svelte/icons/menu';
	import { when } from '#lib/when';
	import { DECIDED, plural, rowNote } from '#lib/words';
	import type { Doc, Heading } from '#lib/types';

	let { data, children } = $props();
	let open = $state(false);
	afterNavigate(() => (open = false));

	const waiting = $derived(data.items.filter((i) => !i.decision && i.kind !== 'report'));
	const toRead = $derived(data.items.filter((i) => !i.decision && i.kind === 'report'));
	const decided = $derived(data.items.filter((i) => i.decision));
	const here = (id: string) => (page.url.pathname === `/d/${id}` ? 'page' : undefined);

	// The outline of the open document. A page with fewer than three headings needs none.
	const outline = $derived.by((): Heading[] => {
		const list = (page.data.doc as Doc | undefined)?.outline ?? [];
		return list.length >= 3 ? list : [];
	});
	const listed = $derived(data.items.some((i) => here(i.id)));
	/** Opens the fold around a heading, so that a link to it has somewhere to land. */
	const unfold = (id: string) => document.getElementById(id)?.closest('details')?.setAttribute('open', '');
	let current = $state('');
	let outlineEl = $state<HTMLElement>();

	// The current section is the last heading that has passed the top of the window.
	$effect(() => {
		const ids = outline.map((h) => h.id);
		if (!ids.length) return;
		let frame = 0;
		const mark = () => {
			frame = 0;
			let at = '';
			for (const id of ids) {
				const el = document.getElementById(id);
				// A heading inside a closed fold has no place on the page.
				if (el?.checkVisibility() && el.getBoundingClientRect().top <= 96) at = id;
			}
			current = at;
		};
		const onscroll = () => (frame ||= requestAnimationFrame(mark));
		mark();
		addEventListener('scroll', onscroll, { passive: true });
		return () => {
			removeEventListener('scroll', onscroll);
			cancelAnimationFrame(frame);
		};
	});
	$effect(() => {
		// Keeps the current entry in view by scrolling the rail alone. `scrollIntoView` would also
		// scroll the window, which moves the document the reader is in.
		const link = current ? outlineEl?.querySelector<HTMLElement>('[aria-current]') : null;
		let box = link?.parentElement;
		while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
		if (!link || !box) return;
		const l = link.getBoundingClientRect();
		const b = box.getBoundingClientRect();
		if (l.top < b.top) box.scrollTop -= b.top - l.top + 8;
		else if (l.bottom > b.bottom) box.scrollTop += l.bottom - b.bottom + 8;
	});

	async function mock(body: Record<string, boolean>) {
		await fetch('/api/mock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		if (body.reset) location.assign('/');
		else await invalidateAll();
	}
</script>

{#snippet onThisPage()}
	<div class="page-outline" bind:this={outlineEl}>
		<p class="page-outline-label" id="outline-label">On this page</p>
		<ul aria-labelledby="outline-label">
			{#each outline as h (h.id)}
				<li>
					<a href="#{h.id}" onclick={() => unfold(h.id)} class:page-outline-sub={h.level === 3} aria-current={current === h.id ? 'location' : undefined}>
						{h.text}
					</a>
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

{#snippet rows(items: typeof data.items)}
	<ul class="grid gap-0.5">
		{#each items as item (item.id)}
			<li>
				<a class="rail-row" href="/d/{item.id}" aria-current={here(item.id)}>
					<span class="clamp-3">{item.title}</span>
					<span class="sub">
						{#if item.decision}
							{DECIDED[item.decision.type]} {when(item.decision.at)}
						{:else}
							{rowNote(item)}
						{/if}
					</span>
				</a>
				{#if here(item.id) && outline.length}
					{@render onThisPage()}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="drawer lg:drawer-open">
	<input id="rail-toggle" type="checkbox" class="drawer-toggle" bind:checked={open} />

	<div class="drawer-content min-w-0">
		<div class="sticky top-0 z-10 flex items-center gap-2 border-b border-base-300 bg-base-200 px-2 py-1.5 lg:hidden">
			<label for="rail-toggle" class="btn btn-ghost btn-sm btn-square" aria-label="Open the list of documents">
				<Menu size={20} aria-hidden="true" />
			</label>
			<a href="/" class="wordmark text-lg"><span class="site-benchmark"></span>Approval Queue</a>
			{#if waiting.length}
				<span class="ms-auto pe-2 text-sm muted">{waiting.length} to decide</span>
			{/if}
		</div>

		{#if data.down}
			<div role="status" class="alert alert-warning mx-4 mt-4 block lg:mx-10">
				<p>
					<strong class="font-semibold">The mockup is acting as if the queue isn't running.</strong>
					Change an answer or approve a document to see what the page says.
				</p>
			</div>
		{/if}

		<main>{@render children()}</main>
	</div>

	<div class="drawer-side z-40">
		<label for="rail-toggle" class="drawer-overlay" aria-label="Close the list of documents"></label>
		<nav class="rail flex min-h-full flex-col" aria-label="Documents">
			<div class="px-5 pt-5 pb-4">
				<a href="/" class="wordmark text-xl"><span class="site-benchmark"></span>Approval Queue</a>
			</div>

			<div class="grid flex-1 content-start gap-6 px-2 pb-6">
				{#if outline.length && !listed}
					<section>{@render onThisPage()}</section>
				{/if}
				<section>
					<h2 class="rail-heading">Outstanding decisions <span>{waiting.length}</span></h2>
					{#if waiting.length}
						{@render rows(waiting)}
					{:else}
						<p class="px-3 text-sm muted">No decisions are outstanding.</p>
					{/if}
				</section>

				{#if toRead.length}
					<section>
						<h2 class="rail-heading">Reports <span>{toRead.length}</span></h2>
						{@render rows(toRead)}
					</section>
				{/if}

				<section>
					<h2 class="rail-heading">Recently merged PRs <span>{data.mergedCount}</span></h2>
					<a class="rail-row" href="/#merged">
						Read what each one changed
					</a>
				</section>

				{#if decided.length}
					<section>
						<h2 class="rail-heading">Decided today <span>{decided.length}</span></h2>
						{@render rows(decided)}
					</section>
				{/if}
			</div>

			<div class="border-t border-base-300 px-5 py-4 text-sm">
				<p class="font-semibold">Mockup only</p>
				<label class="mt-2 flex cursor-pointer items-start gap-2">
					<input
						type="checkbox"
						class="checkbox checkbox-sm mt-0.5"
						checked={data.down}
						onchange={(e) => mock({ down: e.currentTarget.checked })}
					/>
					Act as if the queue isn't running
				</label>
				<button class="btn btn-sm mt-3" onclick={() => mock({ reset: true })}>Reset the mockup</button>
			</div>
		</nav>
	</div>
</div>
