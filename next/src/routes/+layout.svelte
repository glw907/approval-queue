<!--
@component
The one layout every page shares: the rail of waiting documents, with "On this page" under the
open document, and a top bar that opens the rail at narrow widths.
-->
<script lang="ts">
	import '#lib/survey/app.css';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Menu from '@lucide/svelte/icons/menu';
	import { APP, LAYOUT, railNote } from '#lib/strings.ts';
	import type { DecidedRow, OutlineHeading, PageDoc, Row } from '#lib/components/types.ts';

	let { data, children } = $props();
	let open = $state(false);
	afterNavigate(() => (open = false));

	const waiting = $derived(data.rows.filter((r) => r.kind !== 'report'));
	const toRead = $derived(data.rows.filter((r) => r.kind === 'report'));
	const here = (id: string) => (page.url.pathname === `/d/${id}` ? 'page' : undefined);

	// The outline of the open document. A page with fewer than three headings needs none.
	const outline = $derived.by((): OutlineHeading[] => {
		const list = (page.data.doc as PageDoc | undefined)?.outline ?? [];
		return list.length >= 3 ? list : [];
	});
	const listed = $derived([...data.rows, ...data.decided].some((r) => here(r.id)));
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
</script>

{#snippet onThisPage()}
	<div class="page-outline" bind:this={outlineEl}>
		<p class="page-outline-label" id="outline-label">{LAYOUT.onThisPage}</p>
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

{#snippet rows(items: (Row | DecidedRow)[])}
	<ul class="grid gap-0.5">
		{#each items as item (item.id)}
			<li>
				<a class="rail-row" href="/d/{item.id}" aria-current={here(item.id)}>
					<span class="clamp-3">{item.title}</span>
					<span class="sub">{'action' in item ? LAYOUT.decidedNote(item.action, item.at) : railNote(item.tool, item.questions, item.sent)}</span>
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
			<label for="rail-toggle" class="btn btn-ghost btn-sm btn-square" aria-label={LAYOUT.openRail}>
				<Menu size={20} aria-hidden="true" />
			</label>
			<a href="/" class="wordmark text-lg"><span class="site-benchmark"></span>{APP}</a>
			{#if waiting.length}
				<span class="ms-auto pe-2 text-sm muted">{LAYOUT.toDecide(waiting.length)}</span>
			{/if}
		</div>

		<main>{@render children()}</main>
	</div>

	<div class="drawer-side z-40">
		<label for="rail-toggle" class="drawer-overlay" aria-label={LAYOUT.closeRail}></label>
		<nav class="rail flex min-h-full flex-col" aria-label={LAYOUT.rail}>
			<div class="px-5 pt-5 pb-4">
				<a href="/" class="wordmark text-xl"><span class="site-benchmark"></span>{APP}</a>
			</div>

			<div class="grid flex-1 content-start gap-6 px-2 pb-6">
				{#if outline.length && !listed}
					<section>{@render onThisPage()}</section>
				{/if}
				<section>
					<h2 class="rail-heading">{LAYOUT.outstanding} <span>{waiting.length}</span></h2>
					{#if waiting.length}
						{@render rows(waiting)}
					{:else}
						<p class="px-3 text-sm muted">{LAYOUT.noneOutstanding}</p>
					{/if}
				</section>

				{#if toRead.length}
					<section>
						<h2 class="rail-heading">{LAYOUT.reports} <span>{toRead.length}</span></h2>
						{@render rows(toRead)}
					</section>
				{/if}

				<section>
					<h2 class="rail-heading">{LAYOUT.merged} <span>{data.mergedCount}</span></h2>
					<a class="rail-row" href="/#merged">{LAYOUT.readMerged}</a>
				</section>

				{#if data.decided.length}
					<section>
						<h2 class="rail-heading">{LAYOUT.decidedToday} <span>{data.decided.length}</span></h2>
						{@render rows(data.decided)}
					</section>
				{/if}
			</div>
		</nav>
	</div>
</div>
