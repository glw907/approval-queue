<!-- @component
`#margin`, a packet page's notes margin. Selecting text in the reading column, a diff line included,
puts a draft card level with the selection, with the quote and "Add note"; `n` does the same, and
Escape or clearing the selection removes it. A started note stays beside its passage, which is
highlighted with the CSS Custom Highlight API (a browser without it shows no highlight; the card still
quotes the passage). The notes of the item this one revises sit beside their passages too, read-only,
with their replies; one whose passage no longer occurs shows its quote and "This passage changed".

Every note is placed by `locate` from its anchor each time the page changes (a fold opens, a pick moves
a card, the text re-renders), so the margin follows the DOM instead of holding positions. Below the
wide breakpoint the cards stack under the page in document order. A decided packet shows its notes
read-only with their replies. The focus follows a note just started, so typing begins at once.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { CARD_GAP, stack, WIDE_MARGIN, type CardBox } from '#lib/margin-stack.ts';
	import { anchorOfRange, highlight, isDiff, locate, markChanged, sectionTop, visibleAnchor, BODY, type Located } from '#lib/note-dom.ts';
	import type { Notes } from '#lib/notes.svelte.ts';
	import type { DiffAnchor, Earlier, Note, ProseAnchor, Reply } from '#lib/server/items.ts';
	import NoteCard from './NoteCard.svelte';

	interface Props {
		notes: Notes;
		decided: boolean;
		/** The replies stored on this item, for a decided packet's own notes. */
		replies: Reply[];
		/** What a resend carries from the item it revises. */
		earlier?: Earlier;
	}

	let { notes, decided, replies, earlier }: Props = $props();

	interface Entry {
		key: string;
		note: Note;
		readonly: boolean;
		reply: Reply | undefined;
	}

	const entries = $derived<Entry[]>([
		...notes.items.map((note) => ({ key: note.id, note, readonly: decided, reply: replies.find((r) => r.note === note.id) })),
		...(earlier?.notes ?? []).map((note) => ({ key: `earlier-${note.id}`, note, readonly: true, reply: earlier?.replies.find((r) => r.note === note.id) }))
	]);

	let draft = $state<{ anchor: ProseAnchor | DiffAnchor; quote: string } | null>(null);
	/** Each card's top in the margin, the keys top to bottom, and the notes whose passage is gone. */
	let tops = $state<Record<string, number>>({});
	let order = $state<string[]>([]);
	let lost = $state<Set<string>>(new Set());
	let wide = $state(false);

	let margin: HTMLElement | undefined = $state();
	let head: HTMLElement | undefined = $state();
	let frame = 0;
	let tabbing = false;
	let focusNext: string | undefined;
	/* svelte-ignore state_referenced_locally */
	const seen = new Set(notes.items.map((n) => n.id));

	const shown = $derived(entries.toSorted((a, b) => (order.indexOf(a.key) + 1 || Infinity) - (order.indexOf(b.key) + 1 || Infinity)));
	const empty = $derived(!draft && entries.length === 0);
	const quoteOf = (q: string) => (q.length > 96 ? `${q.slice(0, 96)}…` : q).replace(/\s+/g, ' ');

	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(layout);
	};

	/** The offset of an anchored passage's top in the margin. */
	function topOf(at: Located, base: number): number {
		const seat = visibleAnchor(at.el);
		let rect = seat === at.el ? at.range.getBoundingClientRect() : seat.getBoundingClientRect();
		if (!rect.height) rect = seat.getBoundingClientRect();
		return rect.top - base - 4;
	}

	function layout() {
		frame = 0;
		if (!margin || !head) return;
		wide = matchMedia(WIDE_MARGIN).matches;
		if (earlier) markChanged(earlier.changed);
		const base = margin.getBoundingClientRect().top;
		const floor = head.offsetTop + head.offsetHeight + 12;
		const placed: Range[] = [];
		const drafted: Range[] = [];
		const gone = new Set<string>();
		const boxes: CardBox[] = [];
		const items = [...entries.map((e) => ({ key: e.key, anchor: e.note.anchor })), ...(draft ? [{ key: 'draft', anchor: draft.anchor }] : [])];
		for (const { key, anchor } of items) {
			let y = floor;
			if (anchor) {
				const at = locate(anchor);
				if (at) {
					(key === 'draft' ? drafted : placed).push(at.range);
					y = topOf(at, base);
				} else {
					gone.add(key);
					const section = isDiff(anchor) ? null : sectionTop(anchor.section);
					if (section && section.id !== BODY) y = section.getBoundingClientRect().top - base - 4;
				}
			}
			const card = margin.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
			boxes.push({ key, y, h: card?.offsetHeight ?? 0 });
		}
		const current = document.activeElement?.closest('[data-key]')?.getAttribute('data-key') ?? null;
		const next = stack(boxes, current, CARD_GAP, floor);
		if (JSON.stringify(next) !== JSON.stringify(tops)) tops = next;
		const keys = boxes.toSorted((a, b) => a.y - b.y).map((b) => b.key);
		if (keys.join('\n') !== order.join('\n')) order = keys;
		if (gone.size !== lost.size || [...gone].some((k) => !lost.has(k))) lost = gone;
		highlight('note', placed);
		highlight('draft', drafted);
		focusPending();
	}

	/** Moves focus into the note just started, once its card has a place. */
	function focusPending() {
		const key = focusNext;
		if (!key || (wide && tops[key] === undefined)) return;
		focusNext = undefined;
		void tick().then(() => margin?.querySelector<HTMLTextAreaElement>(`[data-key="${CSS.escape(key)}"] textarea`)?.focus());
	}

	// The margin follows the notes and the draft; the effect below follows the page.
	$effect(() => {
		void entries;
		void draft;
		for (const note of notes.items) {
			if (seen.has(note.id)) continue;
			seen.add(note.id);
			if (!decided && note.text === '') focusNext = note.id;
		}
		untrack(focusPending);
		schedule();
	});

	$effect(() => {
		const body = document.getElementById(BODY);
		if (!body || !margin) return;
		const mutations = new MutationObserver(schedule);
		mutations.observe(body, { childList: true, subtree: true, characterData: true });
		const sizes = new ResizeObserver(schedule);
		sizes.observe(body);
		sizes.observe(margin);
		document.addEventListener('toggle', schedule, true);
		addEventListener('resize', schedule);
		void document.fonts.ready.then(schedule);
		return () => {
			mutations.disconnect();
			sizes.disconnect();
			document.removeEventListener('toggle', schedule, true);
			removeEventListener('resize', schedule);
			cancelAnimationFrame(frame);
			frame = 0;
			highlight('note', []);
			highlight('draft', []);
		};
	});

	let reading: ReturnType<typeof setTimeout> | undefined;

	/** Turns the page's selection into a draft; a collapsed one removes it unless focus is moving to the draft's own button. */
	function read() {
		const selection = getSelection();
		const found = !selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim() ? null : anchorOfRange(selection.getRangeAt(0));
		if (found) draft = found;
		else if (!tabbing && !margin?.contains(document.activeElement)) draft = null;
	}

	function start() {
		if (!draft) return;
		const { anchor } = draft;
		draft = null;
		getSelection()?.removeAllRanges();
		// The card opens where the draft was, so it takes focus before the next frame.
		const id = crypto.randomUUID();
		tops = { ...tops, [id]: tops.draft ?? 0 };
		notes.add({ id, text: '', anchor });
	}

	const typing = (el: EventTarget | null) =>
		el instanceof HTMLElement && (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'submit'].includes(el.type)));

	function onKeydown(e: KeyboardEvent) {
		tabbing = e.key === 'Tab';
		if (decided) return;
		if (e.key === 'Escape' && draft) {
			getSelection()?.removeAllRanges();
			draft = null;
		} else if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && desk.singleKeys && draft && !typing(e.target)) {
			e.preventDefault();
			start();
		}
	}

	function onSelection() {
		if (decided) return;
		clearTimeout(reading);
		reading = setTimeout(read, 80);
	}
</script>

<svelte:document onkeydown={onKeydown} onselectionchange={onSelection} onmousedown={() => (tabbing = false)} />

<aside id="margin" class={['margin', wide && 'wide']} aria-label="Notes" bind:this={margin}>
	<div class="mhead" bind:this={head}>
		<h2>Your notes</h2>
		{#if decided}
			{#if empty}<p class="hint">No notes were written.</p>{/if}
		{:else}
			{#if empty}<p class="hint">Select any text, including a line of a diff. A draft note appears here beside it. Press n to start writing. Notes go to the session with your decision.</p>{/if}
			<button type="button" class="btn btn-outline btn-sm" onclick={() => notes.add({ id: crypto.randomUUID(), text: '', anchor: null })}>Note on the whole packet</button>
		{/if}
	</div>
	{#if draft}
		<!-- A press inside the card keeps the page's selection, which the button reads. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="note pending" role="group" aria-label="Draft note" data-key="draft" style:top={wide ? `${tops.draft ?? 0}px` : null} style:visibility={wide && tops.draft === undefined ? 'hidden' : null} onmousedown={(e) => e.preventDefault()}>
			<q>{quoteOf(draft.quote)}</q>
			<button type="button" class="btn btn-primary btn-sm" aria-keyshortcuts={desk.singleKeys ? 'n' : undefined} onclick={start}>Add note <kbd class="kbd kbd-xs" aria-hidden="true">n</kbd></button>
		</div>
	{/if}
	{#if shown.length}
		<ol class="notelist" aria-label="Notes on this packet">
			{#each shown as entry (entry.key)}
				<li class={['note', entry.key.startsWith('earlier-') && 'earlier']} data-key={entry.key} style:top={wide ? `${tops[entry.key] ?? 0}px` : null} style:visibility={wide && tops[entry.key] === undefined ? 'hidden' : null}>
					<NoteCard
						note={entry.note}
						readonly={entry.readonly}
						reply={entry.reply}
						lost={lost.has(entry.key)}
						ontext={(text) => notes.update(entry.note.id, text)}
						ondelete={() => notes.remove(entry.note.id)}
					/>
				</li>
			{/each}
		</ol>
	{/if}
</aside>
