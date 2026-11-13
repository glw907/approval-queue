<!--
@component
The reading column with its notes margin. At 86rem and wider each thread's card sits in the margin
beside the words it is about; narrower, the cards open in a sheet from the bottom of the window.
Selecting words offers a note on them, which is posted to `/api/<id>`, and the threads the answer
carries replace the ones shown. A thread is anchored by its quote, at the occurrence nearest the
offset it was made at; a thread whose words the page can't find draws as an orphan with its quote.
A post that fails keeps what was written and says why, beside the box.
-->
<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
	import X from '@lucide/svelte/icons/x';
	import { NOTES, when } from '#lib/strings.ts';
	import { NOTE_LIMIT, noteLength, type DecideAnswer, type Thread } from './types.ts';

	interface Props {
		/** The document's id, which the note posts go to. */
		id: string;
		/** The newest version's number, which a new note records. */
		version: number;
		threads: Thread[];
		/** Changes whenever the page's text is laid out again, as when change marks are hidden. */
		relayout?: unknown;
		/** Receives the threads the queue answers with after each saved change. */
		onthreads: (threads: Thread[]) => void;
		children: Snippet;
	}
	let { id, version, threads, relayout, onthreads, children }: Props = $props();

	/** Selected words a note can be written on, as offsets into the text index. */
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
	/** The words and text of a draft that Escape closed, so writing on the same words again restores it. */
	let kept: { quote: string; text: string } | null = null;

	const open = $derived(threads.filter((t) => !t.resolved));
	const tooLong = $derived(noteLength(draftText.trim()) > NOTE_LIMIT);
	const replyTooLong = $derived(noteLength(replyText.trim()) > NOTE_LIMIT);
	const DRAFT = 'draft';
	const GAP = 10;
	const key = (t: Thread) => String(t.id);

	let nodes: { node: Text; start: number }[] = [];
	let text = '';
	const ranges = new Map<string, Range>();

	/**
	 * Indexes the column's text nodes, leaving out removed words and anything marked
	 * `data-no-notes`, so offsets are the same with change marks drawn or hidden.
	 */
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

	const CURLY: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };

	/**
	 * Normalizes `raw` for matching, curly quotes to straight and each run of white space to one
	 * space, and answers the offset in `raw` that each character of the result came from.
	 */
	function normalized(raw: string): { flat: string; from: number[] } {
		let flat = '';
		const from: number[] = [];
		for (let i = 0; i < raw.length; i++) {
			const c = raw[i];
			if (/\s/.test(c)) {
				if (flat.endsWith(' ')) continue;
				flat += ' ';
			} else flat += CURLY[c] ?? c;
			from.push(i);
		}
		return { flat, from };
	}

	/** Finds `quote` in the text index, answering its raw start and end, or null when it is gone. */
	function find(quote: string, start: number | undefined, page: { flat: string; from: number[] }): [number, number] | null {
		const q = normalized(quote.trim()).flat;
		if (!q) return null;
		let best: number | null = null;
		for (let at = page.flat.indexOf(q); at >= 0; at = page.flat.indexOf(q, at + 1)) {
			if (start === undefined) {
				best = at;
				break;
			}
			if (best === null || Math.abs(page.from[at] - start) < Math.abs(page.from[best] - start)) best = at;
		}
		if (best === null) return null;
		return [page.from[best], page.from[best + q.length - 1] + 1];
	}

	function layout() {
		if (!main || !('highlights' in CSS)) return;
		index();
		const page = normalized(text);
		ranges.clear();
		const lost: Record<string, boolean> = {};
		for (const t of threads) {
			const at = t.orphan ? null : find(t.quote, t.start, page);
			if (!at) lost[key(t)] = true;
			else ranges.set(key(t), rangeOf(...at));
		}
		if (draft) ranges.set(DRAFT, rangeOf(draft.start, draft.end));
		orphans = lost;

		const quiet = new Highlight();
		const loud = new Highlight();
		for (const [k, r] of ranges) {
			if (k === DRAFT || k === active) loud.add(r);
			else if (!threads.find((t) => key(t) === k)?.resolved) quiet.add(r);
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
		void [threads, active, draft, relayout, wide, replyText === '', failed, tooLong, replyTooLong];
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
		draftText = kept?.quote === draft.quote ? kept.text : '';
		kept = null;
		failed = '';
		active = null;
		getSelection()?.removeAllRanges();
		if (!wide) sheetOpen = true;
	}

	/** Closes the note box and keeps what it held, for a later note on the same words. */
	function shelve() {
		if (draft && draftText.trim()) kept = { quote: draft.quote, text: draftText };
		draft = null;
	}

	function threadAt(x: number, y: number): string | null {
		for (const [k, r] of ranges) {
			if (k === DRAFT || threads.find((t) => key(t) === k)?.resolved) continue;
			for (const b of r.getClientRects()) {
				if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return k;
			}
		}
		return null;
	}

	function clicked(e: MouseEvent) {
		if (!getSelection()?.isCollapsed) return;
		const k = threadAt(e.clientX, e.clientY);
		if (!k) return;
		choose(k);
		if (!wide) sheetOpen = true;
	}

	function hovered(e: MouseEvent) {
		if (main) main.style.cursor = threadAt(e.clientX, e.clientY) ? 'pointer' : '';
	}

	function choose(k: string | null) {
		if (active === k) return;
		active = k;
		replyText = '';
		failed = '';
	}

	/** Posts a note operation, answering the threads the queue now holds, or null with `failed` set. */
	async function send(body: Record<string, unknown>): Promise<Thread[] | null> {
		let res: Response;
		try {
			res = await fetch(`/api/${id}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(10_000)
			});
		} catch {
			failed = NOTES.unsaved;
			return null;
		}
		const reply = (await res.json().catch(() => ({}))) as Partial<DecideAnswer>;
		if (!res.ok || !reply.threads) {
			failed = reply.message ?? NOTES.notSaved(`${res.status} ${res.statusText}`);
			return null;
		}
		failed = '';
		onthreads(reply.threads);
		return reply.threads;
	}

	async function saveDraft() {
		if (!draft || !draftText.trim() || tooLong) return;
		const before = new Set(threads.map(key));
		const now = await send({ op: 'note', quote: draft.quote, start: draft.start, version, text: draftText.trim() });
		if (!now) return;
		draft = null;
		draftText = '';
		const made = now.find((t) => !before.has(key(t)));
		if (made) {
			active = key(made);
			await relay();
			document.querySelector<HTMLElement>(`[data-card="${key(made)}"]:not([hidden])`)?.focus({ preventScroll: wide });
		}
	}

	async function reply(t: Thread) {
		if (!replyText.trim() || replyTooLong) return;
		if (await send({ op: 'reply', thread: t.id, text: replyText.trim() })) replyText = '';
	}

	/** Delete is offered only on a thread whose every entry is Geoff's. */
	const mine = (t: Thread) => t.entries.every((e) => e.who === 'geoff');

	function focus(el: HTMLTextAreaElement) {
		el.focus({ preventScroll: wide });
	}

	function keys(e: KeyboardEvent, run: () => void, escape?: () => void) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			run();
		} else if (e.key === 'Escape' && escape) {
			e.preventDefault();
			e.stopPropagation();
			escape();
		}
	}
</script>

{#snippet failure()}
	{#if failed}
		<p role="alert" class="mt-2 text-error">{failed}</p>
	{/if}
{/snippet}

{#snippet overLimit(over: boolean, typed: string)}
	{#if over}
		<p role="alert" class="mt-2 text-error">{NOTES.tooLong(noteLength(typed.trim()))}</p>
	{/if}
{/snippet}

{#snippet draftCard()}
	{#if draft}
		<div class="note-card on" data-card={DRAFT} style:top="{tops[DRAFT] ?? 0}px">
			{#if draft.writing}
				{#if !wide}<p class="note-quote mb-2">{draft.quote}</p>{/if}
				<label class="sr-only" for="draft-note">{NOTES.draftLabel}</label>
				<textarea
					id="draft-note"
					class="textarea note-field"
					placeholder={NOTES.draftPlaceholder}
					bind:value={draftText}
					use:focus
					onkeydown={(e) => keys(e, saveDraft, shelve)}
				></textarea>
				{@render overLimit(tooLong, draftText)}
				{@render failure()}
				<div class="mt-2 flex gap-2">
					<button class="btn btn-primary btn-sm" disabled={!draftText.trim() || tooLong} onclick={saveDraft}>{NOTES.saveNote}</button>
					<button class="btn btn-ghost btn-sm" onclick={() => (draft = null)}>{NOTES.cancel}</button>
				</div>
			{:else}
				<button class="btn btn-sm w-full justify-start" onmousedown={(e) => e.preventDefault()} onclick={write}>
					<MessageSquarePlus size={16} aria-hidden="true" />
					{NOTES.addNote}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet card(t: Thread)}
	{@const k = key(t)}
	{@const on = active === k}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="note-card"
		class:on
		class:done={t.resolved}
		data-card={k}
		tabindex="-1"
		style:top="{tops[k] ?? 0}px"
		onclick={() => choose(k)}
	>
		{#if orphans[k]}
			<p class="mb-2 muted">{NOTES.orphan}</p>
			<p class="note-quote mb-2">{t.was ?? t.quote}</p>
		{:else if t.was}
			<p class="mb-1 muted">{NOTES.was}</p>
			<p class="note-quote mb-2">{t.was}</p>
		{:else if !wide}
			<p class="note-quote mb-2">{t.quote}</p>
		{/if}
		{#each t.resolved && !on ? t.entries.slice(0, 1) : t.entries as e, i (i)}
			<div class="note-entry">
				<p>
					<span class="note-who" class:claude={e.who === 'claude'}>{e.who === 'geoff' ? NOTES.geoff : NOTES.claude}</span>
					<span class="muted">{when(e.at)}</span>
				</p>
				<p class="whitespace-pre-line" class:clamp-2={t.resolved && !on}>{e.text}</p>
			</div>
		{/each}
		{#if t.resolved}
			<p class="mt-2 flex items-center justify-between gap-2 muted">
				{NOTES.resolved}
				{#if on}
					<button class="btn btn-ghost btn-xs" onclick={() => send({ op: 'resolve', thread: t.id, resolved: false })}>{NOTES.reopen}</button>
				{/if}
			</p>
			{#if on}{@render failure()}{/if}
		{:else if on}
			<label class="sr-only" for="reply-{k}">{NOTES.replyLabel}</label>
			<textarea
				id="reply-{k}"
				class="textarea note-field mt-3"
				placeholder={NOTES.replyPlaceholder}
				bind:value={replyText}
				onkeydown={(e) => keys(e, () => reply(t))}
			></textarea>
			{@render overLimit(replyTooLong, replyText)}
			{@render failure()}
			<div class="mt-2 flex flex-wrap gap-2">
				<button class="btn btn-primary btn-sm" disabled={!replyText.trim() || replyTooLong} onclick={() => reply(t)}>{NOTES.reply}</button>
				<button class="btn btn-ghost btn-sm" onclick={() => send({ op: 'resolve', thread: t.id, resolved: true })}>{NOTES.resolve}</button>
				{#if mine(t)}
					<button class="btn btn-ghost btn-sm" onclick={() => send({ op: 'delete', thread: t.id })}>{NOTES.delete}</button>
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
					{NOTES.open(open.length)}
				</button>
			</p>
		{/if}
		{@render children()}
	</div>

	<aside class="page-margin" aria-label={NOTES.margin}>
		{#if wide}
			<div class="note-cards" class:placed class:settled bind:this={cards} style:min-height="{height}px">
				{@render list()}
			</div>
			{#if !threads.length && !draft}
				<p class="muted" style:font-size="var(--text-step-9)">{NOTES.hint}</p>
			{/if}
		{/if}
	</aside>
</div>

{#if !wide && draft && !draft.writing}
	<div class="follow-bar" style:z-index="30">
		<button class="btn btn-primary btn-sm" onmousedown={(e) => e.preventDefault()} onclick={write}>
			<MessageSquarePlus size={16} aria-hidden="true" />
			{NOTES.addNote}
		</button>
	</div>
{/if}

<dialog
	class="modal modal-bottom"
	bind:this={sheet}
	oncancel={(e) => {
		// Escape in the note box closes the box alone, keeping the sheet open.
		if (draft?.writing && document.activeElement?.id === 'draft-note') {
			e.preventDefault();
			shelve();
		}
	}}
	onclose={() => {
		sheetOpen = false;
		if (draft?.writing) shelve();
	}}
>
	<div class="modal-box max-h-[75dvh]">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="display text-lg">{NOTES.heading}</h2>
			<button class="btn btn-ghost btn-sm btn-square" aria-label={NOTES.close} onclick={() => (sheetOpen = false)}>
				<X size={18} aria-hidden="true" />
			</button>
		</div>
		{#if !wide}
			<div class="grid gap-2">
				{@render list()}
			</div>
			{#if !threads.length && !draft}
				<p class="muted">{NOTES.hint}</p>
			{/if}
		{/if}
	</div>
	<form method="dialog" class="modal-backdrop"><button>{NOTES.closeSheet}</button></form>
</dialog>

<style>
	:global(::highlight(note)) {
		background-color: var(--mark);
	}
	:global(::highlight(note-on)) {
		background-color: var(--mark-active);
	}
</style>
