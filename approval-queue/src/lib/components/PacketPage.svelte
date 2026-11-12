<!-- @component
A packet's page: the status line, headline, and opening; the closed deep dive; "Your calls" with the
session's pick selected on each; "Decided for you"; "Not checked"; then "What changed" and "Reference",
or the design in full for a design packet; and the decision bar. A reading column in the middle, the
queue rail the layout's on its left, and `#margin`, the notes margin, on its right.

A decision never posts from here: like `ItemPanel`, it hands the form data to the layout's `held`
store, which posts after five seconds unless Undo opens the item again, and opens the next item at
once. The primary button ("Approve", or "Answer and resume" on a stop packet) posts `calls`, `decidedForYou`, and `notes` to the `approve` action; Send back posts the
same to `reject`, and with no note it posts nothing and says so. An out-of-date packet disables
Approve. A decided packet shows its picks, notes, and replies as stored and no controls.

The notes margin is `NotesMargin`; this page owns the notes store, the notes a "Say why" starts, and
the claims a diff note needs open.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import type { Call, DecidedCall } from '#lib/facts.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { COUNTING, held, UNDONE } from '#lib/held.svelte.ts';
	import { anchorAt } from '#lib/anchors.ts';
	import { isDiff } from '#lib/note-dom.ts';
	import { Notes, postNotes } from '#lib/notes.svelte.ts';
	import { patchFiles, plural, prLabel, primaryLabel, statusLine, stopSentence } from '#lib/packet-view.ts';
	import { nextItem } from '#lib/queue.ts';
	import type { CallPick, Note } from '#lib/server/items.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import CallCard from './CallCard.svelte';
	import PacketChanged from './PacketChanged.svelte';
	import PacketFold from './PacketFold.svelte';
	import PacketReference from './PacketReference.svelte';
	import NotesMargin from './NotesMargin.svelte';
	import Prose from './Prose.svelte';

	let { data }: { data: Extract<PageData, { kind: 'packet' }> } = $props();

	// The page keys this component on the item id, so what follows is read once per item.
	/* svelte-ignore state_referenced_locally */
	const { packet, meta, decision, decided } = data;
	const { facts, text } = packet;
	/* svelte-ignore state_referenced_locally */
	const restored = held.take(meta.id);

	/** The option number a stored or posted answer names, or the session's own when it names none. */
	const optionOf = (call: Call, label: string | undefined) => {
		const at = call.options.findIndex((o) => o.label === label);
		return at < 0 ? call.recommended : at + 1;
	};
	const stored: CallPick[] = restored ? readJson(restored.form.get('calls'), []) : decision && 'calls' in decision ? decision.calls : [];
	let picks = $state(facts.calls.map((call, i) => optionOf(call, stored.find((p) => p.call === i + 1)?.choice)));
	const changedCount = $derived(facts.calls.filter((call, i) => picks[i] !== call.recommended).length);

	const savedNotes: Note[] = restored ? readJson(restored.form.get('notes'), packet.notes) : packet.notes;
	const notes = new Notes(savedNotes, (all) => postNotes(`${page.url.pathname}?/notes`, all));
	// A diff is not rendered while its claim is closed, so a claim holding a note's line starts open.
	/* svelte-ignore state_referenced_locally */
	const diffNotes = [...savedNotes, ...(data.earlier?.notes ?? [])].flatMap((n) => (n.anchor && isDiff(n.anchor) ? [n.anchor] : []));
	let claimOpen = $state<boolean[]>(text.claims.map((c) => diffNotes.some((a) => a.pr === c.pr && a.file === c.path)));
	let error = $state('');
	let deciding = false;

	function readJson<T>(raw: FormDataEntryValue | null, fallback: T): T {
		try {
			return typeof raw === 'string' ? (JSON.parse(raw) as T) : fallback;
		} catch {
			return fallback;
		}
	}

	const stale = $derived(packet.stale);
	const initiative = $derived(meta.initiativeTitle || (meta.initiative && meta.initiative !== 'none' ? meta.initiative : ''));
	const status = $derived(statusLine(facts, initiative));

	const parsed = new Map<string, ReturnType<typeof patchFiles>>();
	/** The snapshot's files for a pull request, parsed once. */
	function diffs(ref: string) {
		let files = parsed.get(ref);
		if (!files) parsed.set(ref, (files = patchFiles(packet.patches[ref] ?? '')));
		return files;
	}

	const label = (verb: string, n: number) => (n ? `${verb} with ${plural(n, 'note')}` : verb);
	const stateText = $derived(`${changedCount} of ${facts.calls.length} calls changed, ${notes.count === 0 ? '0 notes' : plural(notes.count, 'note')}`);
	const DECIDED = { approve: 'Approved', reject: 'Sent back' };

	/** Opens a claim and brings it into view, for a call's evidence link. */
	async function jump(claim: number) {
		claimOpen[claim] = true;
		await tick();
		const target = document.getElementById(`claim-${claim}`);
		target?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
		target?.querySelector('summary')?.focus({ preventScroll: true });
	}

	/** Starts a note on a call the reader changed, anchored to its heading for the margin to place. */
	function sayWhy(heading: string) {
		if (notes.items.some((n) => n.anchor && !isDiff(n.anchor) && n.anchor.section === 'calls' && n.anchor.quote === heading && n.text.trim() === '')) return;
		const section = document.getElementById('calls')?.textContent ?? '';
		const from = Math.max(0, section.indexOf(heading));
		notes.add({ id: crypto.randomUUID(), text: '', anchor: anchorAt(section, from, from + heading.length, 'calls') });
	}

	/** Moves focus to the next call card's picked option after the one holding focus, wrapping to the first. */
	function nextCall() {
		const cards = [...document.querySelectorAll<HTMLElement>('.packet .call')];
		if (!cards.length) return;
		const at = cards.findIndex((c) => c.contains(document.activeElement));
		const card = cards[(at + 1) % cards.length];
		card.scrollIntoView({ block: 'center' });
		(card.querySelector<HTMLInputElement>('input:checked') ?? card.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true });
	}

	const picksOf = (list: Array<Call | DecidedCall>, chosen: (i: number) => string): CallPick[] =>
		list.map((call, i) => ({ call: i + 1, choice: chosen(i), changed: chosen(i) !== call.options[call.recommended - 1].label }));

	/** Hands the decision to the held store, which posts it after the hold. */
	async function submit(kind: 'approve' | 'reject') {
		if (deciding || decided) return;
		if (held.ids.has(meta.id)) {
			desk.announce(COUNTING);
			return;
		}
		if (kind === 'approve' && stale) return;
		if (kind === 'reject' && notes.count === 0) {
			error = 'A send-back needs at least one note.';
			return;
		}
		error = '';
		deciding = true;
		try {
			await notes.flush();
			const body = new FormData();
			body.set('calls', JSON.stringify(picksOf(facts.calls, (i) => facts.calls[i].options[picks[i] - 1].label)));
			body.set('decidedForYou', JSON.stringify(facts.decidedForYou.map((d, i): CallPick => ({ call: i + 1, choice: d.applied, changed: false }))));
			body.set('notes', JSON.stringify($state.snapshot(notes.items)));
			const toast = kind === 'approve' ? 'Approved the packet.' : 'Sent the packet back with a note.';
			const waiting = data.queue.filter((item) => item.id === meta.id || !held.ids.has(item.id));
			const upNext = nextItem(waiting, meta.id);
			const accepted = held.hold({
				id: meta.id,
				title: facts.title,
				kind: 'packet',
				subject: 'the packet',
				href: new URL(`${page.url.pathname}?/${kind}`, page.url.href).href,
				form: body,
				outcome: kind,
				toast
			});
			if (!accepted) {
				desk.announce(COUNTING);
				return;
			}
			desk.announce(`${toast} ${desk.singleKeys ? 'Press z or the Undo button' : 'Press the Undo button'} to undo.`);
			await goto(upNext ? `/item/${encodeURIComponent(upNext.id)}` : '/', { replace: true });
		} finally {
			deciding = false;
		}
		const main = document.getElementById('main');
		if (main && !main.contains(document.activeElement)) main.focus();
	}

	// An item Undo opened again says so, once.
	$effect(() => {
		if (!restored) return;
		untrack(() => {
			desk.toast = UNDONE;
			desk.announce(UNDONE);
		});
		const clear = setTimeout(() => {
			if (desk.toast === UNDONE) desk.toast = null;
		}, 3200);
		return () => {
			clearTimeout(clear);
			if (desk.toast === UNDONE) desk.toast = null;
		};
	});
	$effect(() => {
		if (held.failure?.href === `/item/${encodeURIComponent(meta.id)}`) held.failure = null;
	});
	$effect(() => {
		desk.page = 'packet';
		return () => (desk.page = 'design');
	});
	$effect(() => {
		if (decided) return;
		return desk.register({ approve: () => void submit('approve'), 'next-call': nextCall });
	});
	// A focused control stays clear of the bar and the toast above it.
	$effect(() => {
		const bar = document.getElementById('decision');
		if (!bar) return;
		const setPad = () => document.documentElement.style.setProperty('--desk-bar-pad', `${bar.offsetHeight + 72}px`);
		setPad();
		const observer = new ResizeObserver(setPad);
		observer.observe(bar);
		return () => {
			observer.disconnect();
			document.documentElement.style.removeProperty('--desk-bar-pad');
		};
	});
	// Typing pauses are saved by the store; leaving the page saves what is pending.
	$effect(() => () => void notes.flush());
</script>

<div class="packet">
	<main id="main" tabindex="-1" class="packet-main">
		<div class="packet-body" id="packet-body">
			<p class="kicker"><b>{status.lead}</b> {status.rest}</p>
			{#if !decided && stopSentence(facts.kind)}<p class="stop-note">{stopSentence(facts.kind)}</p>{/if}
			{#if stale && !decided}
				<div role="note" class="alert alert-warning" id="stale">
					<p>
						<strong>Out of date.</strong>
						{prLabel(stale.ref)} moved from <code>{stale.queued.slice(0, 9)}</code> to <code>{stale.now.slice(0, 9)}</code> after the session wrote this packet. {primaryLabel(facts.kind)} is off. Send it back, or ask the session to send it again.
					</p>
				</div>
			{/if}
			<h1 class="head"><i class="benchmark"></i><Prose text={text.headline} /></h1>

			<section aria-label="Opening" id="opening">
				<div class="prose">
					{#each text.opening as paragraph, i (i)}<p><Prose text={paragraph} /></p>{/each}
				</div>
			</section>

			<PacketFold name="Deep dive" variant="deep" id="deep" eager>
				{#snippet title()}Deep dive{/snippet}
				{#snippet sub()}<Prose text={text.deepDive} />{/snippet}
				{#snippet children()}{@html data.deepDiveHtml}{/snippet}
			</PacketFold>

			{#if facts.calls.length}
				<section aria-labelledby="calls-h" id="calls">
					<h2 class="sec" id="calls-h">Your calls</h2>
					{#if text.callsLead}
						{#each text.callsLead.split('\n\n') as paragraph, i (i)}<p class="prose lead"><Prose text={paragraph} /></p>{/each}
					{/if}
					<p class="secnote">The session’s pick is selected on each. Change one only where you disagree.</p>
					{#each facts.calls as call, i (i)}
						<CallCard {call} text={text.calls[i]} index={i} bind:pick={picks[i]} locked={decided} claims={text.claims} onsaywhy={sayWhy} onjump={jump} />
					{/each}
				</section>
			{/if}

			{#if facts.decidedForYou.length}
				<section aria-labelledby="decided-h" id="decided">
					<h2 class="sec" id="decided-h">Decided for you</h2>
					<p class="secnote">The session took these itself. Each shows the option it applied.</p>
					{#each facts.decidedForYou as call, i (i)}
						<PacketFold name="Decided for you: {text.decided[i].heading}" variant="decided" eager>
							{#snippet title()}{text.decided[i].heading}{/snippet}
							{#snippet sub()}Applied: {call.applied}{/snippet}
							{#snippet children()}
								<p><b>Context.</b> <Prose text={text.decided[i].context} /></p>
								{#if text.decided[i].why}<p><b>Why.</b> <Prose text={text.decided[i].why ?? ''} /></p>{/if}
								<p class="muted">{call.options.find((o) => o.label === call.applied)?.consequence}</p>
							{/snippet}
						</PacketFold>
					{/each}
				</section>
			{/if}

			{#if text.notChecked}
				<div role="note" class="alert alert-warning" id="not-checked">
					<p><strong>Not checked.</strong> <Prose text={text.notChecked} /></p>
				</div>
			{/if}

			{#if facts.kind === 'design'}
				<section aria-labelledby="design-h" id="design">
					<h2 class="sec" id="design-h">The design</h2>
					<article class="design">{@html data.designHtml}</article>
				</section>
			{:else}
				<PacketChanged {packet} {diffs} bind:open={claimOpen} />
				<PacketReference {packet} {diffs} />
			{/if}
		</div>

		<div class="barwrap" id="decision">
			<form class="bar" aria-label="Decision" onsubmit={(e) => e.preventDefault()}>
				<div class="state" id="bar-state">
					{#if decided}
						<span role="status">{decision ? DECIDED[decision.decision as 'approve' | 'reject'] : 'Decided'}, {notes.count === 0 ? '0 notes' : plural(notes.count, 'note')}.</span>
					{:else}
						<span role="status">{stateText}</span>
						{#if error}<small role="alert">{error}</small>{/if}
						{#if notes.failed}<small>The notes are not saved yet; the next change tries again.</small>{/if}
					{/if}
				</div>
				{#if !decided}
					<button type="button" class="btn btn-outline" onclick={() => void submit('reject')}>{label('Send back', notes.count)}</button>
					<button
						type="button"
						class="btn btn-primary"
						disabled={stale !== undefined}
						aria-keyshortcuts="Control+Enter Meta+Enter"
						aria-describedby="bar-state"
						onclick={() => void submit('approve')}
					>
						{label(primaryLabel(facts.kind), notes.count)} <kbd class="kbd kbd-xs desk-kbd" aria-hidden="true">Ctrl ↵</kbd>
					</button>
				{/if}
			</form>
		</div>
	</main>

	<NotesMargin {notes} {decided} replies={packet.replies} earlier={data.earlier} />
</div>
