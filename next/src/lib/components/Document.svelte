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
	/** Where a document stood, as far as the page compares it. */
	type Mark = { state: DocStanding['state']; n: number | null };
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
	const recommended = (q: Question) => q.options.findIndex((o) => o.recommended);
	const mark = (s: { state: DocStanding['state']; n: number | null }): Mark => ({ state: s.state, n: s.n });
	const same = (a: Mark, b: Mark) => a.state === b.state && a.n === b.n;

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
	const unanswered = $derived(questions.filter((q) => picks[q.id] === undefined));
	const report = $derived(doc.kind === 'report');
	const decision = $derived(standing.state === 'decided' || standing.state === 'handed' ? standing.decision : null);

	let busy = $state(false);
	let attempts = 0;
	let failure = $state<Failure | null>(null);
	// A failure shows only while the document stands where it was drawn, so a hand-off or a reload
	// that moved the document on takes the block away with it.
	const shown = $derived(failure && same(failure.at, standing) ? failure : null);
	const answerFailures: Record<string, Failure | undefined> = $state({});
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
		return { what: DOC.refused, why, refused: true, retry: same(now, at), body, at: now, attempt };
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
		let failed: Failure | null = null;
		try {
			failed = await send(body);
			if (!failed || !failed.retry) await invalidateAll();
			if (!failed && body.op === 'decide') for (const q of Object.keys(answerFailures)) answerFailures[q] = undefined;
		} finally {
			failure = failed;
			busy = false;
		}
		await tick();
		const target = failed?.retry ? '[data-retry]' : !failed && body.op === 'undo' ? 'button:not([disabled])' : '[data-decided]';
		(decideEl?.querySelector<HTMLElement>(target) ?? decideEl)?.focus();
	}

	function decide(action: Action) {
		const given = Object.entries($state.snapshot(picks)).filter((e): e is [string, number] => e[1] !== undefined);
		return act({ op: 'decide', action, answers: Object.fromEntries(given) });
	}

	async function answer(body: AnswerBody, retry = false) {
		const seq = (answerSeq[body.question] = (answerSeq[body.question] ?? 0) + 1);
		answerBusy[body.question] = true;
		const failed = await send(body);
		if (seq !== answerSeq[body.question]) return;
		answerBusy[body.question] = false;
		answerFailures[body.question] = failed ?? undefined;
		if (!failed || !retry) return;
		await tick();
		articleEl?.querySelector<HTMLElement>(`[data-retry-answer="${body.question}"]`)?.focus();
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
			if (out) return;
			out = true;
			try {
				const res = await fetch(`/api/${doc.id}`, { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(10_000)]) });
				const now = res.ok ? ((await res.json()) as DecideAnswer).standing : null;
				if (stop.signal.aborted || !now || same(mark(now), was)) return;
				const held = !!decideEl?.contains(document.activeElement);
				await invalidateAll();
				await tick();
				// The hand-off takes the Undo button away; focus that sat on it lands on the new line.
				if (held && !decideEl?.contains(document.activeElement)) decideEl?.querySelector<HTMLElement>('[data-decided]')?.focus();
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
						aria-describedby="{id}-what {id}-why"
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
	<article bind:this={articleEl}>
		<header>
			<p class="doc-meta" data-no-notes>{DOC.sent(doc.tool, doc.sent)}</p>
			<h1 class="doc-title mt-2">{@html doc.titleHtml}</h1>

			{#if doc.returned}
				<div class="doc-meta mt-4" data-no-notes>
					<p>{DOC.returned(doc.returned, doc.changes)}</p>
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
					{@const lost = standing.state === 'waiting' ? answerFailures[seg.id] : undefined}
					<fieldset class="question">
						<legend class="sr-only">{seg.label}</legend>
						{#each seg.options as o, i (i)}
							<label class="question-option">
								<input
									type="radio"
									class="radio radio-sm radio-primary"
									name="{doc.id}-{seg.id}"
									value={i}
									disabled={busy || standing.state !== 'waiting'}
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
						<div data-no-notes>
							{@render notRecorded(
								lost,
								() => answerBusy[seg.id] || answer(lost.body as AnswerBody, true),
								!!answerBusy[seg.id],
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
							<p>{DOC.withdrawn}</p>
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
											disabled={unanswered.length > 0}
											aria-disabled={busy || undefined}
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
