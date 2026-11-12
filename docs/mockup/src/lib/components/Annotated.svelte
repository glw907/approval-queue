<!--
@component
The reading column with its notes margin. A note is anchored to the words it was made on, found
again by their position and then by their text, so a note survives an edit to the lines around it.
A note whose words are gone stays in the margin and shows the words it was made on.
-->
<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
	import X from '@lucide/svelte/icons/x';
	import { post } from '#lib/api';
	import { when } from '#lib/when';
	import type { DocState, Thread } from '#lib/types';

	interface Props {
		/** The document's id. */
		id: string;
		threads: Thread[];
		/** Changes when the page's text is laid out again, such as when change marks are hidden. */
		relayout?: unknown;
		/** Receives the stored state after each saved change. */
		onstate: (state: DocState) => void;
		children: Snippet;
	}
	let { id, threads, relayout, onstate, children }: Props = $props();

	interface Draft {
		quote: string;
		start: number;
		end: number;
		writing: boolean;
	}

	let main = $state<HTMLElement>();
	let cards = $state<HTMLElement>();
	let sheet = $state<HTMLDialogElement>();
	let wide = $state(true);
	let sheetOpen = $state(false);
	let active = $state<string | null>(null);
	let draft = $state<Draft | null>(null);
	let draftText = $state('');
	let replyText = $state('');
	let failed = $state('');
	let tops = $state<Record<string, number>>({});
	let height = $state(0);
	let orphans = $state<Record<string, boolean>>({});
	let placed = $state(false);
	let settled = $state(false);

	const open = $derived(threads.filter((t) => !t.resolved));
	const DRAFT = 'draft';
	const GAP = 10;

	let nodes: { node: Text; start: number }[] = [];
	let text = '';
	const ranges = new Map<string, Range>();

	function index() {
		nodes = [];
		text = '';
		if (!main) return;
		const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) =>
				n.parentElement?.closest('del, [data-no-notes]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
		});
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			nodes.push({ node: n as Text, start: text.length });
			text += n.nodeValue;
		}
	}

	function point(offset: number, atEnd: boolean): [Text, number] {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const { node, start } = nodes[i];
			if (offset > start || (!atEnd && offset === start)) return [node, Math.min(offset - start, node.length)];
		}
		return [nodes[0].node, 0];
	}

	function rangeOf(start: number, end: number): Range {
		const r = document.createRange();
		r.setStart(...point(start, false));
		r.setEnd(...point(end, true));
		return r;
	}

	function find(quote: string, start?: number): number {
		if (start !== undefined && text.startsWith(quote, start)) return start;
		return text.indexOf(quote);
	}

	function layout() {
		if (!main || !('highlights' in CSS)) return;
		index();
		ranges.clear();
		const lost: Record<string, boolean> = {};
		for (const t of threads) {
			const at = find(t.quote, t.start);
			if (at < 0) lost[t.id] = true;
			else ranges.set(t.id, rangeOf(at, at + t.quote.length));
		}
		if (draft) ranges.set(DRAFT, rangeOf(draft.start, draft.end));
		orphans = lost;

		const quiet = new Highlight();
		const loud = new Highlight();
		for (const [key, r] of ranges) {
			if (key === DRAFT || key === active) loud.add(r);
			else if (!threads.find((t) => t.id === key)?.resolved) quiet.add(r);
		}
		CSS.highlights.set('note', quiet);
		CSS.highlights.set('note-on', loud);

		if (!cards || !wide) return;
		const origin = cards.getBoundingClientRect().top;
		const rows = [...cards.querySelectorAll<HTMLElement>('[data-card]')].map((el) => {
			const r = ranges.get(el.dataset.card!);
			return { el, key: el.dataset.card!, y: r ? r.getBoundingClientRect().top - origin : Infinity };
		});
		rows.sort((a, b) => a.y - b.y);
		const next: Record<string, number> = {};
		let floor = 0;
		for (const row of rows) {
			const top = Math.max(row.y === Infinity ? floor : row.y - 4, floor);
			next[row.key] = top;
			floor = top + row.el.offsetHeight + GAP;
		}
		tops = next;
		height = floor;
		if (!placed) requestAnimationFrame(() => requestAnimationFrame(() => (settled = true)));
		placed = true;
	}

	const relay = () => tick().then(layout);

	$effect(() => {
		void [threads, active, draft, relayout, wide, replyText === '', failed];
		relay();
	});

	$effect(() => {
		if (!sheet) return;
		if (sheetOpen && !wide && !sheet.open) sheet.showModal();
		if ((!sheetOpen || wide) && sheet.open) sheet.close();
	});

	onMount(() => {
		const mq = matchMedia('(min-width: 86rem)');
		const sync = () => (wide = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		const ro = new ResizeObserver(layout);
		ro.observe(main!);
		document.fonts.ready.then(layout);
		document.addEventListener('selectionchange', selected);
		return () => {
			mq.removeEventListener('change', sync);
			ro.disconnect();
			document.removeEventListener('selectionchange', selected);
			CSS.highlights?.delete('note');
			CSS.highlights?.delete('note-on');
		};
	});

	function selected() {
		if (draft?.writing) return;
		const sel = getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount || !main) {
			if (draft) draft = null;
			return;
		}
		const r = sel.getRangeAt(0);
		if (!main.contains(r.commonAncestorContainer)) return;
		index();
		const hit = nodes.filter((n) => r.intersectsNode(n.node));
		if (!hit.length) return;
		const first = hit[0];
		const last = hit[hit.length - 1];
		let start = first.start + (first.node === r.startContainer ? r.startOffset : 0);
		let end = last.start + (last.node === r.endContainer ? r.endOffset : last.node.length);
		const raw = text.slice(start, end);
		start += raw.length - raw.trimStart().length;
		end -= raw.length - raw.trimEnd().length;
		if (end <= start) return;
		draft = { quote: text.slice(start, end), start, end, writing: false };
	}

	function write() {
		if (!draft) return;
		draft.writing = true;
		draftText = '';
		failed = '';
		active = null;
		getSelection()?.removeAllRanges();
		if (!wide) sheetOpen = true;
	}

	function threadAt(x: number, y: number): string | null {
		for (const [key, r] of ranges) {
			if (key === DRAFT || threads.find((t) => t.id === key)?.resolved) continue;
			for (const b of r.getClientRects()) {
				if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return key;
			}
		}
		return null;
	}

	function clicked(e: MouseEvent) {
		if (!getSelection()?.isCollapsed) return;
		const key = threadAt(e.clientX, e.clientY);
		if (!key) return;
		choose(key);
		if (!wide) sheetOpen = true;
	}

	function hovered(e: MouseEvent) {
		if (main) main.style.cursor = threadAt(e.clientX, e.clientY) ? 'pointer' : '';
	}

	function choose(key: string | null) {
		if (active === key) return;
		active = key;
		replyText = '';
		failed = '';
	}

	async function send(body: Record<string, unknown>): Promise<boolean> {
		try {
			onstate(await post(id, body));
			failed = '';
			return true;
		} catch {
			failed = "The queue isn't running, so your note wasn't saved. What you wrote is still here.";
			return false;
		}
	}

	async function saveDraft() {
		if (!draft || !draftText.trim()) return;
		if (await send({ op: 'note', quote: draft.quote, start: draft.start, text: draftText.trim() })) {
			draft = null;
			draftText = '';
		}
	}

	async function reply(t: Thread) {
		if (!replyText.trim()) return;
		if (await send({ op: 'reply', thread: t.id, text: replyText.trim() })) replyText = '';
	}

	const mine = (t: Thread) => t.entries.every((e) => e.who === 'geoff' && !e.example);

	function focus(el: HTMLTextAreaElement) {
		el.focus({ preventScroll: wide });
	}

	function keys(e: KeyboardEvent, run: () => void) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			run();
		}
	}
</script>

{#snippet failure()}
	{#if failed}
		<p role="alert" class="mt-2 text-error">{failed}</p>
	{/if}
{/snippet}

{#snippet draftCard()}
	{#if draft}
		<div class="note-card on" data-card={DRAFT} style:top="{tops[DRAFT] ?? 0}px">
			{#if draft.writing}
				{#if !wide}<p class="note-quote mb-2">{draft.quote}</p>{/if}
				<label class="sr-only" for="draft-note">Your note on the highlighted passage</label>
				<textarea
					id="draft-note"
					class="textarea note-field"
					placeholder="Write your note"
					bind:value={draftText}
					use:focus
					onkeydown={(e) => keys(e, saveDraft)}
				></textarea>
				{@render failure()}
				<div class="mt-2 flex gap-2">
					<button class="btn btn-primary btn-sm" disabled={!draftText.trim()} onclick={saveDraft}>Add note</button>
					<button class="btn btn-ghost btn-sm" onclick={() => (draft = null)}>Cancel</button>
				</div>
			{:else}
				<button class="btn btn-sm w-full justify-start" onmousedown={(e) => e.preventDefault()} onclick={write}>
					<MessageSquarePlus size={16} aria-hidden="true" /> Add a note
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet card(t: Thread)}
	{@const on = active === t.id}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="note-card"
		class:on
		class:done={t.resolved}
		data-card={t.id}
		style:top="{tops[t.id] ?? 0}px"
		onclick={() => choose(t.id)}
	>
		{#if orphans[t.id]}
			<p class="mb-2 muted">The passage this note is about is no longer in the document. It read:</p>
			<p class="note-quote mb-2">{t.quote}</p>
		{:else if t.was}
			<p class="mb-1 muted">Before the edit, this read:</p>
			<p class="note-quote mb-2">{t.was}</p>
		{:else if !wide}
			<p class="note-quote mb-2">{t.quote}</p>
		{/if}
		{#each t.resolved && !on ? t.entries.slice(0, 1) : t.entries as e, i (i)}
			<div class="note-entry">
				<p>
					<span class="note-who" class:claude={e.who === 'claude'}>{e.who === 'geoff' ? 'Geoff' : 'Claude'}</span>
					<span class="muted">{when(e.time)}{e.example ? ', an example' : ''}</span>
				</p>
				<p class:clamp-2={t.resolved && !on}>{e.text}</p>
			</div>
		{/each}
		{#if t.resolved}
			<p class="mt-2 flex items-center justify-between gap-2 muted">
				Resolved
				{#if on}
					<button class="btn btn-ghost btn-xs" onclick={() => send({ op: 'resolve', thread: t.id, resolved: false })}>Reopen</button>
				{/if}
			</p>
		{:else if on}
			<label class="sr-only" for="reply-{t.id}">Your reply</label>
			<textarea
				id="reply-{t.id}"
				class="textarea note-field mt-3"
				placeholder="Reply"
				bind:value={replyText}
				onkeydown={(e) => keys(e, () => reply(t))}
			></textarea>
			{@render failure()}
			<div class="mt-2 flex flex-wrap gap-2">
				<button class="btn btn-primary btn-sm" disabled={!replyText.trim()} onclick={() => reply(t)}>Reply</button>
				<button class="btn btn-ghost btn-sm" onclick={() => send({ op: 'resolve', thread: t.id, resolved: true })}>Resolve</button>
				{#if mine(t)}
					<button class="btn btn-ghost btn-sm" onclick={() => send({ op: 'delete', thread: t.id })}>Delete</button>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet list()}
	{@render draftCard()}
	{#each threads as t (t.id)}
		{@render card(t)}
	{/each}
{/snippet}

<div class="page">
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class="page-main" bind:this={main} onclick={clicked} onmousemove={hovered}>
		{#if !wide && threads.length}
			<p class="mb-3 flex justify-end" data-no-notes>
				<button class="btn btn-sm" onclick={() => (sheetOpen = true)}>
					<MessageSquare size={16} aria-hidden="true" />
					{open.length === 1 ? '1 open note' : `${open.length} open notes`}
				</button>
			</p>
		{/if}
		{@render children()}
	</div>

	<aside class="page-margin" aria-label="Notes">
		{#if wide}
			<div class="note-cards" class:placed class:settled bind:this={cards} style:min-height="{height}px">
				{@render list()}
			</div>
			{#if !threads.length && !draft}
				<p class="muted" style:font-size="var(--text-step-9)">
					To write a note, select any words in the document.
				</p>
			{/if}
		{/if}
	</aside>
</div>

{#if !wide && draft && !draft.writing}
	<div class="follow-bar" style:z-index="30">
		<button class="btn btn-primary btn-sm" onmousedown={(e) => e.preventDefault()} onclick={write}>
			<MessageSquarePlus size={16} aria-hidden="true" /> Add a note
		</button>
	</div>
{/if}

<dialog
	class="modal modal-bottom"
	bind:this={sheet}
	onclose={() => {
		sheetOpen = false;
		if (draft?.writing) draft = null;
	}}
>
	<div class="modal-box max-h-[75dvh]">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="display text-lg">Notes</h2>
			<button class="btn btn-ghost btn-sm btn-square" aria-label="Close the notes" onclick={() => (sheetOpen = false)}>
				<X size={18} aria-hidden="true" />
			</button>
		</div>
		{#if !wide}
			<div class="grid gap-2">
				{@render list()}
			</div>
			{#if !threads.length && !draft}
				<p class="muted">To write a note, select any words in the document.</p>
			{/if}
		{/if}
	</div>
	<form method="dialog" class="modal-backdrop"><button>Close</button></form>
</dialog>

<style>
	:global(::highlight(note)) {
		background-color: var(--mark);
	}
	:global(::highlight(note-on)) {
		background-color: var(--mark-active);
	}
</style>
