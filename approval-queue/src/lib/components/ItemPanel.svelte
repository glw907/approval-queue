<!-- @component
One open item in the three-pane frame: a switch on the item's kind picks its header, its work, its
review pane, and the decision bar's labels, and the frame supplies the rest. The page renders it
inside a `{#key}` on the item's id, so per-item state here (the note, a failed post) starts fresh
when the next item loads. Triage calls are the exception: unsent ones are kept in `desk.drafts`, so
opening another item and coming back keeps them.

A decision never posts from here. The submit function cancels the form's own post and hands its
form data to the layout's `held` store, then opens the next waiting item at once (or the board
when none is left), replacing the history entry so the tab stays script-closable. The store posts
after five seconds unless Undo opens this item again; the new panel then takes the decision back
and seeds its note, a packet's answers, a design's picks, and triage rows from the held form data,
so the item returns as it was left.

Every Approve uses `aria-disabled` rather than `disabled` while calls are open, so a locked press
still arrives and moves focus to the first open ask or card. A packet whose steps cannot be undone
asks for one confirmation first, which posts as `irreversible=yes`.

A packet decides as a whole: every routine part and step posts the session's own verdict as a
hidden `part:<ref>` field, which the server still reads to build the decision.
-->
<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { tick, untrack } from 'svelte';
	import { age, spokenAge } from '#lib/board.ts';
	import { fingerprint, gate } from '#lib/cards.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { COUNTING, held, seedFrom, UNDONE } from '#lib/held.svelte.ts';
	import { nextItem } from '#lib/queue.ts';
	import { changedCount, seedRows, type Row } from '#lib/triage.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import BriefBlock from './BriefBlock.svelte';
	import DecideCards from './DecideCards.svelte';
	import DesignView from './DesignView.svelte';
	import DetailRows from './DetailRows.svelte';
	import DecisionBar from './frame/DecisionBar.svelte';
	import Frame from './frame/Frame.svelte';
	import FrameHeader from './frame/FrameHeader.svelte';
	import PaneList, { type PaneItem } from './frame/PaneList.svelte';
	import PaneSection from './frame/PaneSection.svelte';
	import PacketAsks from './PacketAsks.svelte';
	import PacketBrief from './PacketBrief.svelte';
	import PacketIcon from './PacketIcon.svelte';
	import PacketRoutine from './PacketRoutine.svelte';
	import PacketWhatChanged from './PacketWhatChanged.svelte';
	import Prose from './Prose.svelte';
	import TriageView from './TriageView.svelte';

	let { data }: { data: PageData } = $props();

	let form = $state<HTMLFormElement>();
	let noteField = $state<HTMLTextAreaElement>();
	let noteText = $state('');
	let approveButton = $state<HTMLButtonElement>();
	let rejectButton = $state<HTMLButtonElement>();
	let sendButton = $state<HTMLButtonElement>();
	let submitButton = $state<HTMLButtonElement>();
	let confirmDialog = $state<HTMLDialogElement>();
	// The page keys this component on the item id, so a decision Undo handed back is taken once.
	// svelte-ignore state_referenced_locally
	const restored = held.take(data.meta.id);
	// svelte-ignore state_referenced_locally
	const seed = restored ? seedFrom(restored.form, data.kind) : null;
	noteText = seed?.note ?? '';

	// The poll hands the panel a new `data` every two seconds, so effects read these instead: a
	// derived that keeps its value does not re-run them.
	const kind = $derived(data.kind);
	const isDecided = $derived(data.decided);

	// The page keys this component on the item id, so the rows are read once per item.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		data.kind === 'triage'
			? data.decided
				? data.rows
				: seed?.rows.length === data.rows.length
					? data.rows.map((row, i) => ({ ...row, ...(seed.rows[i] as Pick<Row, 'disposition'>) }))
					: seedRows(data.rows, desk.drafts.get(data.meta.id))
			: []
	);
	const changed = $derived(changedCount(rows));

	$effect(() => {
		if (data.kind !== 'triage' || data.decided) return;
		if (changedCount(rows) > 0) desk.drafts.set(data.meta.id, $state.snapshot(rows));
		else desk.drafts.delete(data.meta.id);
	});

	// A card's pick is its choice's index; Approve unlocks once every card has one and none sends back.
	let picks = $state<Array<number | undefined>>(seed?.picks ?? []);
	const cards = $derived(data.kind === 'design' ? data.cards : []);
	const decided = $derived(gate(cards, picks));

	// A packet's asks are answered by label; the page keys this component on the item id, so they are
	// read once per item. A decided packet starts from what was decided.
	// svelte-ignore state_referenced_locally
	let answers = $state<Record<number, string | undefined>>(
		data.kind === 'packet' && data.decision?.decision === 'approve'
			? Object.fromEntries((data.decision.asks ?? []).map((ask) => [ask.index, ask.choice]))
			: (seed?.answers ?? {})
	);
	const asks = $derived(data.kind === 'packet' ? data.asks : []);
	const openAsks = $derived(asks.filter((ask) => answers[ask.index] === undefined));
	const packetLock = $derived(
		openAsks.length
			? `Answer ${openAsks.length} more ${openAsks.length === 1 ? 'ask' : 'asks'}`
			: 'Ready to approve'
	);
	const packetSub = $derived(openAsks.length ? 'to unlock Approve' : 'Every ask is answered.');

	/** The decisions the screen asks for, in page order: what the pane lists and F8 walks. */
	const calls = $derived.by((): Array<{ id: string; label: string; what: string; open: boolean }> => {
		if (data.kind === 'packet') {
			return data.asks.map((ask) => {
				const picked = answers[ask.index];
				return {
					id: `ask-${ask.index}`,
					label: ask.question,
					what: picked === undefined ? 'Open, pick one' : `Answered: ${picked}`,
					open: picked === undefined
				};
			});
		}
		return cards.map((card, i) => ({
			id: `card-${i}`,
			label: card.title,
			what: picks[i] === undefined ? 'Open' : 'Decided',
			open: picks[i] === undefined
		}));
	});
	const callItems = $derived<PaneItem[]>(
		calls.map((c) => ({ href: `#${c.id}`, label: c.label, what: c.what, dot: c.open ? 'call' : 'done' }))
	);
	const TRIAGE_WORD = { now: 'Do now', defer: 'Do later', drop: 'Don’t do' };
	const yourSteps = $derived<PaneItem[]>(
		data.kind === 'packet'
			? data.steps.filter((s) => s.tag === 'you').map((s) => ({ href: `#step-${s.n}`, label: `${s.n}. ${s.label ?? s.text}`, dot: 'call' as const }))
			: []
	);
	const packet = $derived(data.kind === 'packet' ? data : null);
	/** The repos the packet's PR and design parts live in, by name, in order of first appearance. */
	const packetRepos = $derived(
		packet ? [...new Set(packet.parts.filter((p) => p.kind !== 'step').map((p) => p.ref.split(/[#:]/)[0].split('/').pop()))].join(', ') : ''
	);

	/** Motion rule 5: a jump scrolls smoothly, unless the reader asked for reduced motion. */
	const jump = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

	/** Moves focus to the next open call after the one holding focus, wrapping to the first. */
	function nextCall() {
		const open = calls.filter((c) => c.open);
		if (!open.length) return;
		const at = open.findIndex((c) => document.getElementById(c.id)?.contains(document.activeElement));
		const target = document.getElementById(open[(at + 1) % open.length].id);
		target?.scrollIntoView({ block: 'center', behavior: jump() });
		(target?.querySelector<HTMLElement>('input, button, a, textarea') ?? target)?.focus({ preventScroll: true });
	}

	// An item Undo opened again says so, once: a send-back reopens its note as it was, and any other
	// decision puts focus in the item, as opening it after a decision does. Nothing here is tracked,
	// so typing in the note never runs it again.
	$effect(() => {
		if (!restored) return;
		untrack(() => {
			desk.toast = UNDONE;
			desk.announce(UNDONE);
			if (restored.outcome === 'reject') void openNote();
			else {
				const main = document.getElementById('main');
				if (main && !main.contains(document.activeElement)) main.focus();
			}
		});
		const clear = setTimeout(() => {
			if (desk.toast === UNDONE) desk.toast = null;
		}, 3200);
		return () => {
			clearTimeout(clear);
			if (desk.toast === UNDONE) desk.toast = null;
		};
	});
	// A failed post links here, so opening the item ends the toast that named it.
	$effect(() => {
		if (held.failure?.href === `/item/${encodeURIComponent(data.meta.id)}`) held.failure = null;
	});

	$effect(() => {
		desk.page = kind;
		return () => (desk.page = 'design');
	});

	$effect(() => {
		if (isDecided) return;
		return desk.register({
			approve: kind === 'packet' ? approvePacket : approveCards,
			'next-call': nextCall,
			'open-note': openNote,
			'close-note': closeNote,
			'send-rejection': () => form?.requestSubmit(sendButton),
			submit: () => form?.requestSubmit(submitButton)
		});
	});

	// Only the panel going, on opening another item, closes the note.
	$effect(() => () => (desk.noteOpen = false));

	// Its own effect: a pick must not re-run the handler registration.
	$effect(() => {
		desk.approveLocked = data.kind === 'packet' ? openAsks.length > 0 : decided.locked;
		return () => (desk.approveLocked = false);
	});

	// Keep a focused control clear of the bar and the toast above it.
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

	/** Approve on a packet: a locked press moves to the first open ask, an irreversible packet asks once more. */
	async function approvePacket() {
		if (confirmDialog?.open) return;
		if (openAsks.length) {
			document.querySelector<HTMLElement>(`#ask-${openAsks[0].index} input[type="radio"]`)?.focus();
			return;
		}
		if (data.kind === 'packet' && data.irreversible) confirmDialog?.showModal();
		else form?.requestSubmit(approveButton);
	}

	/** Approve on a design: a locked press moves to the first open card. */
	function approveCards() {
		if (decided.sendBack) return;
		if (decided.open.length) {
			const card = document.getElementById(`card-${cards.indexOf(decided.open[0])}`);
			card?.scrollIntoView({ block: 'center' });
			card?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
			return;
		}
		form?.requestSubmit(approveButton);
	}

	async function openNote() {
		desk.noteOpen = true;
		await tick();
		// The bar is sticky, so the note is in view as soon as it renders and focusing it needs no scroll.
		noteField?.focus({ preventScroll: true });
		noteField?.setSelectionRange(noteText.length, noteText.length);
	}

	async function closeNote() {
		desk.noteOpen = false;
		await tick();
		// The opener sits in the sticky bar, inside the scroll padding, so a plain focus() scrolls the document.
		rejectButton?.focus({ preventScroll: true });
	}

	/** The repo's name; a design reads as its title. */
	function subject() {
		if (data.kind === 'design') return `the design ${data.meta.title}`;
		if (data.kind === 'packet') return 'the packet';
		return data.meta.repo.split('/').pop();
	}

	function decisionText(action: URL) {
		if (action.search === '?/approve') return `Approved ${subject()}.`;
		if (action.search === '?/reject') return noteText.trim() ? `Sent ${subject()} back with a note.` : `Sent ${subject()} back.`;
		return `Submitted ${rows.length} calls.`;
	}

	// Set from a decision until the next item opens, so a second press during the navigation can't
	// hold the same item twice.
	let deciding = false;

	// The custom enhance cancels the post and never calls `applyAction`: the held store posts the
	// decision later, and the form's own result would reload or redirect the item the reader has left.
	const decide: SubmitFunction = async ({ cancel, action, formData }) => {
		cancel();
		if (deciding) return;
		if (held.ids.has(data.meta.id)) {
			desk.announce(COUNTING);
			return;
		}
		deciding = true;
		try {
			const outcome = action.search === '?/approve' ? 'approve' : action.search === '?/reject' ? 'reject' : 'submit';
			// Every held item is left out, so the next one is never an item whose decision is still counting.
			const waiting = data.queue.filter((item) => item.id === data.meta.id || !held.ids.has(item.id));
			const upNext = nextItem(waiting, data.meta.id);
			const text = decisionText(action);
			const accepted = held.hold({
				id: data.meta.id,
				title: data.meta.headline ?? data.meta.title,
				kind: data.kind,
				subject: subject() ?? data.meta.repo,
				href: action.href,
				form: formData,
				outcome,
				toast: text
			});
			if (!accepted) {
				desk.announce(COUNTING);
				return;
			}
			desk.announce(`${text} ${desk.singleKeys ? 'Press z or the Undo button' : 'Press the Undo button'} to undo.`);
			await goto(upNext ? `/item/${encodeURIComponent(upNext.id)}` : '/', { replace: true });
		} finally {
			deciding = false;
		}
		// The empty state puts focus on Keep itself, so only a main that holds no focus gets it.
		const main = document.getElementById('main');
		if (main && !main.contains(document.activeElement)) main.focus();
	};
</script>

{#snippet itemState()}
	{#if data.meta.orphaned}
		<span class="badge badge-sm badge-outline rule-badge tone-warning">No session is waiting for this.</span>
	{/if}
{/snippet}

<Frame
	where={data.meta.headline ?? data.meta.title}
	paneLabel={data.kind === 'packet' ? 'Calls and steps' : 'Calls for you'}
>
	{#snippet header()}
		{#if packet}
			<!-- A packet stored before titles can carry a long one-sentence headline. -->
			<FrameHeader
				headlineText={packet.headline}
				crumbs={[
					{ text: 'Board', href: '/' },
					{ text: 'Packet' },
					...(packet.meta.initiativeTitle ? [{ text: packet.meta.initiativeTitle }] : []),
					...(packetRepos ? [{ text: packetRepos }] : [])
				]}
			>
				{#snippet state()}
					<span>Waiting <time datetime={packet.meta.created}><span aria-hidden="true">{age(packet.meta.created)}</span><span class="sr-only">{spokenAge(packet.meta.created)}</span></time></span>
					{#if packet.revision}<span class="badge badge-sm badge-outline rule-badge tone-info">Revision {packet.revision}</span>{/if}
					{#if packet.irreversible}
						<span class="badge badge-sm badge-outline rule-badge tone-error gap-1"><PacketIcon name="lock" class="size-3.5" />Irreversible</span>
					{/if}
					{@render itemState()}
				{/snippet}
				{#snippet headline()}<Prose text={packet.headline} />{/snippet}
				{#snippet description()}
					{#each [packet.background, ...packet.summary] as paragraph, i (i)}<p><Prose text={paragraph} /></p>{/each}
				{/snippet}
			</FrameHeader>
		{:else if data.kind === 'design' || data.kind === 'triage'}
			{@const item = data}
			<FrameHeader
				headlineText={item.headlineHtml.replace(/<[^>]*>/g, '')}
				crumbs={[
					{ text: 'Board', href: '/' },
					...(item.kind === 'design'
						? [{ text: 'Design' }, { text: item.meta.repo.split('/').pop() ?? '' }, ...(item.meta.file ? [{ text: item.meta.file }] : [])]
						: [{ text: 'Triage' }, { text: item.meta.title }])
				]}
			>
				{#snippet state()}
					{#if item.kind === 'design'}
						<span>{item.minutes} min read</span>
					{/if}
					{@render itemState()}
				{/snippet}
				{#snippet headline()}{@html item.headlineHtml}{/snippet}
				{#snippet lede()}{@html item.ledeHtml}{/snippet}
			</FrameHeader>
		{/if}
	{/snippet}


	{#if packet}
		{#if packet.whatChanged || packet.sentBack}<PacketWhatChanged bullets={packet.whatChanged ?? []} note={packet.sentBack?.note} />{/if}
		<PacketBrief data={packet} />
		<PacketAsks asks={packet.asks} parts={packet.parts} bind:answers decided={packet.decided} />
		<PacketRoutine routine={packet.routine} parts={packet.parts} />
	{:else if data.kind === 'design'}
		<BriefBlock whatChanges={data.whatChanges} ifYouApprove={data.ifYouApprove} worthKnowing={data.worthKnowing} />
		<DecideCards cards={data.cards} bind:picks decided={data.decided} />
		<DetailRows details={data.details} />
		<div class="mt-10"><DesignView docHtml={data.docHtml} /></div>
	{:else if data.kind === 'triage'}
		<TriageView bind:rows html={data.html} />
	{/if}

	{#snippet pane()}
		{#if packet}
			<PaneSection title="Calls for you"><PaneList items={callItems} empty="No asks in this packet." /></PaneSection>
			{#if yourSteps.length}<PaneSection title="Steps you run"><PaneList items={yourSteps} /></PaneSection>{/if}
		{:else if data.kind === 'triage'}
			{@const html = data.html}
			<PaneSection title="Calls for you">
				<PaneList
					empty="Nothing proposed."
					items={rows.map((row, i) => ({
						href: `#item-${i}`,
						label: row.action,
						labelHtml: html[i]?.label,
						what: row.disposition === row.proposed ? `${TRIAGE_WORD[row.disposition]}, as proposed` : `${TRIAGE_WORD[row.disposition]}, your change`,
						dot: 'call'
					}))}
				/>
			</PaneSection>
		{:else}
			<PaneSection title="Calls for you"><PaneList items={callItems} empty="Nothing to decide first." /></PaneSection>
		{/if}
	{/snippet}

	{#snippet bar()}
		{#if data.decided}
			<DecisionBar>
				{#snippet status()}<p class="s1" role="status">Decided</p>{/snippet}
			</DecisionBar>
		{:else}
			<form
				id="decision-form"
				method="post"
				action={data.kind === 'triage' ? '?/submit' : undefined}
				bind:this={form}
				use:enhance={decide}
				aria-label="Decision"
			>
				{#if packet}
					<input type="hidden" name="fingerprint" value={packet.fingerprint} />
					{#each packet.routine as row (row.ref)}<input type="hidden" name="part:{row.ref}" value={row.verdict} />{/each}
				{:else if data.kind === 'triage'}
					{#each rows as row, i (i)}
						<input type="hidden" name="disposition" value={row.disposition} />
					{/each}
				{:else}
					<input type="hidden" name="cards" value={fingerprint(cards)} />
				{/if}
				<DecisionBar>
					{#snippet note()}
						{#if desk.noteOpen}
							<fieldset class="sendback fieldset">
								<legend class="fieldset-legend lead">What should the session change?</legend>
								<p class="muted" id="note-hint">
									{packet
										? 'Your answers go with this note.'
										: 'The session reads it as the reason; leave it empty to send back without one.'}
								</p>
								<textarea
									id="note"
									name="note"
									class="textarea desk-field w-full"
									aria-label="Your note"
									aria-describedby="note-hint"
									bind:this={noteField}
									bind:value={noteText}
								></textarea>
								<div class="acts">
									<button type="button" class="btn" aria-keyshortcuts="Escape" onclick={closeNote}>Cancel <kbd aria-hidden="true">Esc</kbd></button>
									<button class="btn btn-primary" formaction="?/reject" aria-keyshortcuts="Control+Enter Meta+Enter" bind:this={sendButton}>
										Send back <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
									</button>
								</div>
							</fieldset>
						{/if}
					{/snippet}
					{#snippet reject()}
						{#if data.kind !== 'triage' && !desk.noteOpen}
							<button
								type="button"
								class={['btn', decided.sendBack && !packet ? 'btn-primary' : 'btn-outline']}
								bind:this={rejectButton} onclick={openNote}>
								Send back with note
							</button>
						{/if}
					{/snippet}
					{#snippet status()}
						{#if packet}
							<p class="s1" role="status">{packetLock}</p>
							<p class="s2">{packetSub}</p>
						{:else if data.kind === 'triage'}
							<p class="s1" role="status">{rows.length} calls, {changed === 0 ? 'none' : changed} changed</p>
							<p class="s2">Submit sends your calls back to the session.</p>
						{:else if decided.sendBack}
							<p class="s1" role="status">Sending back</p>
							<p class="s2">You chose to send this back to the session.</p>
						{:else if decided.open.length}
							<p class="s1" role="status">{decided.open.length} {decided.open.length === 1 ? 'decision' : 'decisions'} left</p>
							<p class="s2">
								Decide <a class="link" href="#card-{cards.indexOf(decided.open[0])}">{decided.open[0].title}</a> to unlock Approve.
							</p>
						{:else}
							<p class="s1" role="status">Ready to approve</p>
							<p class="s2">{cards.length > 0 ? 'Every decision is made.' : ''}</p>
						{/if}
					{/snippet}
					{#snippet approve()}
						{#if packet}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								aria-keyshortcuts="Control+Enter Meta+Enter"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={openAsks.length > 0}
								onclick={(e) => {
									e.preventDefault();
									approvePacket();
								}}
							>
								Approve the packet <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
							</button>
						{:else if data.kind === 'triage'}
							<button class="btn btn-primary" aria-keyshortcuts="Control+Enter Meta+Enter" bind:this={submitButton}>
								Submit calls <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
							</button>
						{:else if !decided.sendBack}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								aria-keyshortcuts={desk.singleKeys ? 'Control+Enter Meta+Enter a' : 'Control+Enter Meta+Enter'}
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={decided.locked}
								onclick={(e) => {
									e.preventDefault();
									approveCards();
								}}
							>
								Approve the design <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
							</button>
						{/if}
					{/snippet}
				</DecisionBar>
			</form>
		{/if}
	{/snippet}
</Frame>

{#if data.kind === 'packet' && data.irreversible && !data.decided}
	<dialog id="confirm" class="modal" aria-labelledby="confirm-title" aria-describedby="confirm-body" bind:this={confirmDialog}>
		<div class="modal-box max-w-md rounded-box border border-base-300 p-5">
			<h2 id="confirm-title" class="desk-title flex items-center gap-2 text-xl">
				<PacketIcon name="lock" class="size-5 tone-error" />This approval cannot be undone later
			</h2>
			<div id="confirm-body">
			{#if data.irreversibleSteps.length}
				<p class="mt-2 leading-relaxed">Approving lets the session run these steps, and none of them can be reverted:</p>
				<ul class="mt-1 list-disc ps-5 leading-relaxed">
					{#each data.steps.filter((step) => data.irreversibleSteps.includes(step.n)) as step (step.n)}
						<li><Prose text={step.text} /></li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 leading-relaxed">An ask in this packet is marked irreversible.</p>
			{/if}
			<p class="mt-2 text-sm desk-muted">Undo still works for 5 seconds after you confirm.</p>
			</div>
			<div class="modal-action mt-4">
				<!-- svelte-ignore a11y_autofocus: the safe choice takes focus when the dialog opens, so Enter never confirms an irreversible approval -->
				<button type="button" class="btn btn-ghost" autofocus onclick={() => confirmDialog?.close()}>Cancel</button>
				<button
					type="submit"
					class="btn btn-error"
					form="decision-form"
					formaction="?/approve"
					name="irreversible"
					value="yes"
					onclick={() => confirmDialog?.close()}
				>
					Approve and run them
				</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button>Close</button></form>
	</dialog>
{/if}
