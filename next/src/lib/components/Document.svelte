<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Check from '@lucide/svelte/icons/check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Annotated from './Annotated.svelte';
	import { DOC } from '#lib/strings.ts';
	import type { DecideAnswer, DocStanding, PageDoc } from '#lib/components/types.ts';
	import type { Segment } from '#lib/doc/types.ts';

	interface Props {
		doc: PageDoc;
		/** Where the document stood when the page loaded, refreshed by every `invalidateAll`. */
		standing: DocStanding;
		/** The picks the queue has stored for the open questions. */
		answers: Record<string, number>;
	}
	let { doc, standing, answers }: Props = $props();

	type Question = Extract<Segment, { type: 'question' }>;
	type Action = 'approve' | 'sendback' | 'read';
	type AnswerBody = { op: 'answer'; question: string; pick: number };
	type Body = AnswerBody | { op: 'decide'; action: Action; answers: Record<string, number> } | { op: 'undo' };
	/** Where a document stood, as far as the page compares it. `seq` tells one waiting spell from the next. */
	type Mark = Pick<DocStanding, 'state' | 'n' | 'seq'>;
	/**
	 * A post the queue didn't record: the line saying what, the reason, the body to send again, and
	 * the standing it was drawn against. `retry` is false for a refusal that moved the document on,
	 * since sending it again could only be refused again.
	 */
	interface Failure {
		what: string;
		why: string;
		refused: boolean;
		retry: boolean;
		body: Body;
		at: Mark;
		/** Counts failures, so a repeat of the same one is drawn, and announced, afresh. */
		attempt: number;
	}

	const questions = $derived(doc.segments.filter((s): s is Question => s.type === 'question'));
	/** Off, the article hides each removed passage and draws each added one as plain text. */
	let showChanges = $state(true);
	const recommended = (q: Question) => q.options.findIndex((o) => o.recommended);
	const mark = (s: Mark): Mark => ({ state: s.state, n: s.n, seq: s.seq });
	const same = (a: Mark, b: Mark) => a.state === b.state && a.n === b.n && a.seq === b.seq;

	// The page keys this component on the document's id, so the first document's answers are the
	// only ones it holds. A stored pick wins over the recommended one, and the decision's record wins
	// over both, since it holds what was decided.
	const picks: Record<string, number | undefined> = $state(
		untrack(() => {
			const start: Record<string, number | undefined> = {};
			for (const q of questions) start[q.id] = recommended(q) >= 0 ? recommended(q) : undefined;
			Object.assign(start, answers);
			for (const [qid, a] of Object.entries(standing.decision?.answers ?? {})) start[qid] = a.pick;
			return start;
		})
	);
	// A redraw into a decision, as from another tab, sets the radios to the answers it recorded.
	$effect(() => {
		const recorded = decision?.answers;
		if (recorded) untrack(() => Object.entries(recorded).forEach(([qid, a]) => (picks[qid] = a.pick)));
	});
	const unanswered = $derived(questions.filter((q) => picks[q.id] === undefined));
	const report = $derived(doc.kind === 'report');
	const decision = $derived(standing.state === 'decided' || standing.state === 'handed' ? standing.decision : null);

	let busy = $state(false);
	/** What the section's hidden live line says once the document is open again after an Undo. */
	let said = $state('');
	let attempts = 0;
	let failure = $state<Failure | null>(null);
	// A failure shows only while the document stands where it was drawn, so a hand-off or a reload
	// that moved the document on takes the block away with it.
	const shown = $derived(failure && same(failure.at, standing) ? failure : null);
	const answerFailures: Record<string, Failure | undefined> = $state({});
	/**
	 * The failure question `qid` draws: only while the document waits, and only in the spell it was
	 * drawn against, so an answer lost before an approve and an Undo never comes back after them.
	 */
	const answerShown = (qid: string) => {
		const f = answerFailures[qid];
		return f && standing.state === 'waiting' && same(f.at, standing) ? f : undefined;
	};
	const answerBusy: Record<string, boolean> = $state({});
	/** The latest answer post for each question, so a slower, older reply can't draw over it. */
	const answerSeq: Record<string, number> = {};
	let articleEl = $state<HTMLElement>();
	let decideEl = $state<HTMLElement>();

	/** The line for a click that got no answer from the queue. */
	function unsentLine(body: Body): string {
		if (body.op === 'answer') return DOC.answerUnsent;
		if (body.op === 'undo') return DOC.undoUnsent;
		return body.action === 'read' ? DOC.readUnsent : DOC.decisionUnsent;
	}

	/** Posts `body`, answering null once the queue has recorded it, or else the failure to draw. */
	async function send(body: Body): Promise<Failure | null> {
		const at = mark(standing);
		const attempt = ++attempts;
		let res: Response;
		try {
			res = await fetch(`/api/${doc.id}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(10_000)
			});
		} catch (e) {
			const slow = e instanceof DOMException && e.name === 'TimeoutError';
			return { what: unsentLine(body), why: slow ? DOC.tooSlow : DOC.queueDown, refused: false, retry: true, body, at, attempt };
		}
		if (res.ok) return null;
		const reply = (await res.json().catch(() => ({}))) as Partial<DecideAnswer>;
		const why = reply.message ?? DOC.notSaved(`${res.status} ${res.statusText}`);
		const now = reply.standing ? mark(reply.standing) : at;
		// A 4xx refusal, such as a malformed body or a merge with no stored heads, would only be
		// refused again, so Try again is offered only when the server itself failed and the
		// document still stands where the page drew it.
		const retry = res.status >= 500 && (!reply.standing || same(now, at));
		return { what: DOC.refused, why, refused: true, retry, body, at: now, attempt };
	}

	/**
	 * Posts a decision or an Undo, and redraws from the server only once it is on disk. A refusal
	 * whose answer shows the document moved on, as when another tab decided first or the session
	 * took the decision before an Undo, redraws too, with the refusal shown against the new state.
	 */
	async function act(body: Body) {
		if (busy) return;
		// The buttons mark themselves busy with aria-disabled, never disabled, so focus stays on the
		// one clicked while the post is out.
		busy = true;
		said = '';
		let failed: Failure | null = null;
		try {
			failed = await send(body);
			if (!failed || !failed.retry) await invalidateAll();
			if (!failed && body.op === 'undo') said = DOC.undone;
		} finally {
			failure = failed;
			busy = false;
		}
		await tick();
		if (failed?.retry) land('[data-retry]');
		else if (!failed && body.op === 'undo') land(ENABLED);
		else land('[data-decided]', ENABLED);
	}

	/** A control a keyboard can use: neither disabled nor marked so. */
	const ENABLED = 'button:not([disabled],[aria-disabled="true"])';

	/** Focuses the first of `targets` the decide section draws, or the section itself. */
	function land(...targets: string[]) {
		for (const t of targets) {
			const el = decideEl?.querySelector<HTMLElement>(t);
			if (el) return el.focus();
		}
		decideEl?.focus();
	}

	function decide(action: Action) {
		if (action === 'approve' && unanswered.length) return;
		const given = Object.entries($state.snapshot(picks)).filter((e): e is [string, number] => e[1] !== undefined);
		return act({ op: 'decide', action, answers: Object.fromEntries(given) });
	}

	/** Whether focus is in question `qid`: on one of its radios or in its not-recorded block. */
	function focusIn(qid: string): boolean {
		const el = document.activeElement;
		return el instanceof HTMLElement && el.closest('[data-question]')?.getAttribute('data-question') === qid;
	}

	/** Whether focus is on a control the keyboard can still use, and not lost to the body. */
	function focusLive(): boolean {
		const el = document.activeElement;
		return el instanceof HTMLElement && el !== document.body && el.isConnected && !el.matches(':disabled,[aria-disabled="true"]');
	}

	/**
	 * Posts an answer and draws its failure against the document's standing, as `act` does for a
	 * decision. Focus moves only when it was in this question when the answer came back and the
	 * redraw took it away.
	 */
	async function answer(body: AnswerBody) {
		const qid = body.question;
		const seq = (answerSeq[qid] = (answerSeq[qid] ?? 0) + 1);
		answerBusy[qid] = true;
		const failed = await send(body);
		if (seq !== answerSeq[qid]) return;
		answerBusy[qid] = false;
		const held = focusIn(qid);
		// A refusal that can't be retried may show the document moved on, as when another tab decided
		// it, so the page redraws from the queue.
		if (failed && !failed.retry) await invalidateAll();
		answerFailures[qid] = failed ?? undefined;
		// A question no longer open can't draw its refusal, so the decide section does.
		const moved = !!failed && standing.state !== 'waiting' && same(failed.at, standing);
		if (moved && !busy) failure = failed;
		await tick();
		if (!held || (focusIn(qid) && focusLive())) return;
		if (moved) return land('[data-decided]', ENABLED);
		const radios = `input[name="${doc.id}-${qid}"]:not(:disabled)`;
		const target =
			(answerShown(qid)?.retry && articleEl?.querySelector<HTMLElement>(`[data-retry-answer="${qid}"]`)) ||
			articleEl?.querySelector<HTMLElement>(`${radios}:checked`) ||
			articleEl?.querySelector<HTMLElement>(radios);
		if (target) target.focus();
		else land('[data-decided]', ENABLED);
	}

	// While a decision waits for the hand-off, ask the queue where it stands every 2 seconds and
	// redraw only on a change. An `invalidateAll` poll would throw the page away if the server
	// stopped. The cleanup aborts a poll still out, so an old one never redraws a newer page.
	$effect(() => {
		if (report || standing.state !== 'decided') return;
		const was = mark(standing);
		const stop = new AbortController();
		let out = false;
		const timer = setInterval(async () => {
			// While a post is out, `act` alone redraws and moves focus.
			if (out || busy) return;
			out = true;
			try {
				const res = await fetch(`/api/${doc.id}`, { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(10_000)]) });
				const now = res.ok ? ((await res.json()) as DecideAnswer).standing : null;
				if (stop.signal.aborted || busy || !now || same(mark(now), was)) return;
				const held = !!decideEl?.contains(document.activeElement);
				if (now.state === 'waiting') said = DOC.reopened;
				await invalidateAll();
				await tick();
				// The hand-off, or an Undo from another tab, takes the focused button away.
				if (held && !decideEl?.contains(document.activeElement)) land('[data-decided]', ENABLED);
			} catch {
				// The queue is down or slow: the page keeps what it shows and asks again.
			} finally {
				out = false;
			}
		}, 2000);
		return () => {
			clearInterval(timer);
			stop.abort();
		};
	});
</script>

{#snippet notRecorded(f: Failure, retry: () => void, waiting: boolean, key?: string)}
	{@const id = `${doc.id}-${key ?? 'decide'}-failure`}
	{#key f.attempt}
		<div role="alert" class="alert alert-error mt-4 block">
			{#if f.refused}
				<p id="{id}-what"><strong class="font-semibold">{f.what}</strong></p>
				<p id="{id}-why" class="mt-1">{f.why}</p>
			{:else}
				<p><strong class="font-semibold" id="{id}-why">{f.why}</strong> <span id="{id}-what">{f.what}</span></p>
			{/if}
			{#if f.retry}
				<p class="mt-3">
					<button
						type="button"
						class="btn btn-sm"
						data-retry={key ? undefined : ''}
						data-retry-answer={key}
						aria-describedby="{id}-what {id}-why{key && shown?.retry ? ` ${doc.id}-decide-failure-what` : ''}"
						aria-disabled={waiting || undefined}
						onclick={retry}
					>
						{DOC.tryAgain}
					</button>
				</p>
			{/if}
		</div>
	{/key}
{/snippet}

<Annotated>
	<article bind:this={articleEl} class:changes-off={!showChanges}>
		<header>
			<p class="doc-meta" data-no-notes>{DOC.sent(doc.tool, doc.sent)}</p>
			<h1 class="doc-title mt-2">{@html doc.titleHtml}</h1>

			{#if doc.returned && doc.whole}
				<div class="doc-meta mt-4" data-no-notes>
					<p>{DOC.wholeChanged}</p>
				</div>
			{:else if doc.returned}
				<div class="doc-meta mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2" data-no-notes>
					<p>{DOC.returned(doc.returned, doc.changes)}</p>
					<label class="flex cursor-pointer items-center gap-2 text-base-content">
						<input type="checkbox" class="toggle toggle-sm toggle-primary" bind:checked={showChanges} />
						{DOC.showChanges}
					</label>
				</div>
			{/if}

			{#if doc.prs.length && doc.tool}
				<div class="doc-meta mt-4" data-no-notes>
					<p>{DOC.merges(doc.prs.length, doc.tool)}</p>
					<ol class="mt-1 grid gap-0.5">
						{#each doc.prs as pr, i (pr.url)}
							<li class="flex flex-wrap items-baseline gap-x-3">
								<span class="text-base-content">{DOC.prLine(i + 1, pr.words, pr.number)}</span>
								<a href={pr.url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1">
									{DOC.prLink(pr.number)} <ExternalLink size={14} aria-hidden="true" />
								</a>
							</li>
						{/each}
					</ol>
				</div>
			{/if}
		</header>

		<div class="mt-7">
			{#each doc.segments as seg, n (n)}
				{#if seg.type === 'html'}
					<div class="prose-doc">{@html seg.html}</div>
				{:else if seg.type === 'question'}
					{@const lost = answerShown(seg.id)}
					<fieldset class="question" data-question={seg.id} aria-describedby={lost ? `${doc.id}-${seg.id}-failure-what ${doc.id}-${seg.id}-failure-why` : undefined}>
						<legend class="sr-only">{seg.label}</legend>
						{#each seg.options as o, i (i)}
							<label class="question-option">
								<input
									type="radio"
									class="radio radio-sm radio-primary"
									name="{doc.id}-{seg.id}"
									value={i}
									disabled={busy || !!shown?.retry || standing.state !== 'waiting'}
									bind:group={picks[seg.id]}
									onchange={() => answer({ op: 'answer', question: seg.id, pick: i })}
								/>
								<span>
									{@html o.html}
									{#if o.recommended}
										<span class="badge badge-sm badge-outline ms-1 align-baseline" data-no-notes>{DOC.recommended}</span>
									{/if}
								</span>
							</label>
						{/each}
					</fieldset>
					{#if lost}
						<div data-no-notes data-question={seg.id}>
							{@render notRecorded(
								lost,
								() => answerBusy[seg.id] || busy || !!shown?.retry || answer(lost.body as AnswerBody),
								!!answerBusy[seg.id] || busy || !!shown?.retry,
								seg.id
							)}
						</div>
					{/if}
				{:else}
					<section
						class="decide"
						bind:this={decideEl}
						tabindex="-1"
						data-no-notes
						aria-label={DOC.decision}
						aria-busy={busy}
					>
						<p class="sr-only" role="status">{standing.state === 'waiting' ? said : ''}</p>
						{#if decision}
							<div role="status">
								<h2 class="flex items-center gap-2" tabindex="-1" data-decided>
									<Check size={18} aria-hidden="true" class="text-success" />
									{decision.action === 'approve'
										? DOC.approved(decision.at)
										: decision.action === 'sendback'
											? DOC.sentBack(decision.at)
											: DOC.markedRead(decision.at)}
								</h2>
								<p class="mt-1 muted">{DOC.recorded}</p>
								{#if decision.action !== 'read'}
									<p class="mt-3 muted">{standing.state === 'handed' ? DOC.handoffAfter : DOC.handoffBefore}</p>
								{/if}
							</div>
							{#if decision.action === 'approve' && questions.length}
								<ul class="answers mt-3">
									{#each questions as q (q.id)}
										<li>
											<span class="muted">{q.label}</span>
											<span>{decision.answers?.[q.id]?.label}</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if decision.action !== 'read'}
								{@const html = decision.action === 'approve' ? doc.approve : doc.sendback}
								{#if html}<p class="ui-code mt-3">{@html html}</p>{/if}
							{/if}
							{#if shown}
								{@render notRecorded(shown, () => act(shown.body), busy)}
							{/if}
							{#if standing.state === 'decided' && !shown?.retry}
								<p class="mt-4">
									<button type="button" class="btn btn-sm" aria-disabled={busy || undefined} onclick={() => act({ op: 'undo' })}>
										{decision.action === 'approve' ? DOC.undoApprove : decision.action === 'sendback' ? DOC.undoSendback : DOC.markUnread}
									</button>
								</p>
							{/if}
						{:else if standing.state === 'withdrawn'}
							<p tabindex="-1" data-decided>{DOC.withdrawn}</p>
							{#if shown}
								{@render notRecorded(shown, () => act(shown.body), busy)}
							{/if}
						{:else if report}
							<h2>{DOC.reportHeading}</h2>
							<p class="mt-1 muted">{DOC.reportNote}</p>
							{#if shown}
								{@render notRecorded(shown, () => act(shown.body), busy)}
							{/if}
							{#if !shown?.retry}
								<p class="mt-4">
									<button type="button" class="btn btn-primary" aria-disabled={busy || undefined} onclick={() => decide('read')}>
										{DOC.markRead}
									</button>
								</p>
							{/if}
						{:else}
							{#if questions.length}
								<h2>{DOC.answers}</h2>
								<ul class="answers mt-2">
									{#each questions as q (q.id)}
										{@const r = recommended(q)}
										{@const p = picks[q.id]}
										<li>
											<span class="muted">{q.label}</span>
											<span>
												{#if p === undefined}
													<span class="text-error">{DOC.notAnswered}</span>
												{:else}
													{q.options[p].label}{#if r >= 0 && p !== r}{' '}<span class="muted">{DOC.notRecommended}</span>{/if}
												{/if}
											</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if shown}
								{@render notRecorded(shown, () => act(shown.body), busy)}
							{/if}
							{#if !shown?.retry}
								<div class="mt-5 grid gap-5">
									<div>
										<button
											type="button"
											class="btn btn-primary"
											aria-disabled={busy || unanswered.length > 0 || undefined}
											aria-describedby={unanswered.length ? `${doc.id}-unanswered` : undefined}
											onclick={() => decide('approve')}
										>
											{questions.length ? DOC.approveWithAnswers : DOC.approve}
										</button>
										{#if unanswered.length}
											<p class="mt-1 text-error" id="{doc.id}-unanswered">{DOC.unanswered(unanswered.map((q) => q.label))}</p>
										{/if}
										{#if doc.approve}<p class="ui-code mt-2">{@html doc.approve}</p>{/if}
									</div>
									<div>
										<button type="button" class="btn" aria-disabled={busy || undefined} onclick={() => decide('sendback')}>{DOC.sendBack}</button>
										{#if doc.sendback}<p class="ui-code mt-2">{@html doc.sendback}</p>{/if}
										<p class="mt-1 muted">{DOC.noNotesWaiting}</p>
									</div>
								</div>
							{/if}
						{/if}
					</section>
				{/if}
			{/each}
		</div>
	</article>
</Annotated>
