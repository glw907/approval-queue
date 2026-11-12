<!--
@component
One document from a session: its header, its text with each question asked where the text raises
it, and the decision. A choice or a decision shows as recorded only after the queue's server has
confirmed it. When the server does not answer, the page says the choice was not sent.
-->
<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Check from '@lucide/svelte/icons/check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Annotated from './Annotated.svelte';
	import { post } from '#lib/api';
	import { count, when } from '#lib/when';
	import { capital, plural, toolName } from '#lib/words';
	import type { Decision, Doc, DocState, Segment } from '#lib/types';

	interface Props {
		doc: Doc;
		/** The state the server held when the page loaded. */
		initial: DocState;
	}
	let { doc, initial }: Props = $props();

	type Question = Extract<Segment, { type: 'question' }>;
	const questions = doc.segments.filter((s): s is Question => s.type === 'question');
	const recommended = (q: Question) => q.options.findIndex((o) => o.recommended);

	function defaults(): Record<string, number> {
		const picks: Record<string, number> = {};
		for (const q of questions) {
			const r = recommended(q);
			if (r >= 0) picks[q.id] = r;
		}
		return picks;
	}

	let threads = $state(initial.threads);
	let picks = $state({ ...defaults(), ...(initial.decision?.answers ?? initial.answers) });
	let decision = $state<Decision | undefined>(initial.decision);
	let showChanges = $state(true);
	let unsent = $state('');
	let busy = $state(false);
	let decideEl = $state<HTMLElement>();
	let decideSeen = $state(true);

	const answered = $derived(questions.filter((q) => picks[q.id] !== undefined).length);
	const differing = $derived(questions.filter((q) => recommended(q) >= 0 && picks[q.id] !== recommended(q)).length);
	const myNotes = $derived(threads.filter((t) => !t.resolved && t.entries.at(-1)?.who === 'geoff').length);
	const report = doc.kind === 'report';

	const standing = $derived.by(() => {
		if (!questions.length) return '';
		const n = count(questions.length).toLowerCase();
		if (answered < questions.length) return `You have answered ${count(answered).toLowerCase()} of ${n} questions.`;
		if (questions.length === 1) return differing ? 'Your answer differs from the recommended one.' : 'The question is set to the recommended answer.';
		if (!differing) return `${questions.length === 2 ? 'Both' : `All ${n}`} questions are set to the recommended answer.`;
		return `${plural(differing, 'answer')} of ${n} ${differing === 1 ? 'differs' : 'differ'} from the recommended one.`;
	});

	function onstate(state: DocState) {
		threads = state.threads;
	}

	async function pick(q: Question, i: number) {
		picks[q.id] = i;
		try {
			await post(doc.id, { op: 'answer', question: q.id, option: i });
			unsent = '';
		} catch {
			unsent = "Your answer shows on this page but isn't saved. If you reload the page, you lose it.";
		}
	}

	async function decide(type: Decision['type']) {
		busy = true;
		try {
			const state = await post(doc.id, { op: 'decide', type, answers: $state.snapshot(picks) });
			decision = state.decision;
			unsent = '';
			await invalidateAll();
		} catch {
			unsent =
				type === 'read'
					? "The report isn't marked as read. Start the queue, and then select Mark as read again."
					: "Your decision wasn't recorded, and the session hasn't seen it. Start the queue, and then choose again.";
		}
		busy = false;
	}

	async function undo() {
		busy = true;
		try {
			await post(doc.id, { op: 'undo' });
			decision = undefined;
			unsent = '';
			await invalidateAll();
		} catch {
			unsent = 'Your decision still stands. Start the queue, and then undo it again.';
		}
		busy = false;
	}

	$effect(() => {
		if (!decideEl) return;
		const io = new IntersectionObserver(([e]) => (decideSeen = e.isIntersecting));
		io.observe(decideEl);
		return () => io.disconnect();
	});

	const toDecision = () => decideEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
</script>

<Annotated id={doc.id} {threads} relayout={[showChanges, decision, unsent]} {onstate}>
	<article class:changes-off={!showChanges}>
		<header>
			<p class="doc-meta" data-no-notes>
				A session in {toolName(doc.repo)} sent this {when(doc.sent)}.
			</p>
			<h1 class="doc-title mt-2">{@html doc.titleHtml}</h1>

			{#if doc.returned}
				<div class="doc-meta mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2" data-no-notes>
					<p>
						You sent this back with notes. It came back {when(doc.returned)} with
						{plural(doc.changes, 'passage').toLowerCase()} changed.
					</p>
					<label class="flex cursor-pointer items-center gap-2 text-base-content">
						<input type="checkbox" class="toggle toggle-sm toggle-primary" bind:checked={showChanges} />
						Show what changed
					</label>
				</div>
			{/if}

			{#if doc.prs.length}
				<div class="doc-meta mt-4" data-no-notes>
					<p>
						Approving this merges {plural(doc.prs.length, 'pull request').toLowerCase()} into {toolName(doc.repo)}{doc.prs.length > 1
							? ', in this order:'
							: ':'}
					</p>
					<ol class="mt-1 grid gap-0.5">
						{#each doc.prs as pr, i (pr.number)}
							<li class="flex flex-wrap items-baseline gap-x-3">
								<span class="text-base-content">{i + 1}. {capital(pr.name)} (#{pr.number})</span>
								<a href={pr.url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1">
									Read the changes in #{pr.number} on GitHub <ExternalLink size={14} aria-hidden="true" />
								</a>
							</li>
						{/each}
					</ol>
				</div>
			{/if}

			{#if doc.mock}
				<div role="note" class="alert alert-info mt-5 block" data-no-notes>
					<p><strong class="font-semibold">About this page of the mockup.</strong> {@html doc.mock}</p>
				</div>
			{/if}
		</header>

		<div class="mt-7">
			{#each doc.segments as seg, n (n)}
				{#if seg.type === 'html'}
					<div class="prose-doc">{@html seg.html}</div>
				{:else if seg.type === 'question'}
					<fieldset class="question">
						<legend class="sr-only">{seg.name}</legend>
						{#each seg.options as o, i (i)}
							<label class="question-option">
								<input
									type="radio"
									class="radio radio-sm radio-primary"
									name="{doc.id}-{seg.id}"
									checked={picks[seg.id] === i}
									disabled={!!decision}
									onchange={() => pick(seg, i)}
								/>
								<span>
									{@html o.html}
									{#if o.recommended}
										<span class="badge badge-sm badge-outline ms-1 align-baseline" data-no-notes>Recommended</span>
									{/if}
								</span>
							</label>
						{/each}
					</fieldset>
				{:else}
					<section class="decide" bind:this={decideEl} data-no-notes aria-label="Your decision">
						{#if decision}
							<h2 class="flex items-center gap-2">
								<Check size={18} aria-hidden="true" class="text-success" />
								{#if decision.type === 'approve'}
									You approved this {when(decision.at)}.
								{:else if decision.type === 'sendback'}
									You sent this back {when(decision.at)}.
								{:else}
									You marked this read {when(decision.at)}.
								{/if}
							</h2>
							<p class="mt-1 muted">The queue has recorded it.</p>
							{#if decision.type === 'approve' && questions.length}
								<ul class="answers mt-3">
									{#each questions as q (q.id)}
										<li>
											<span class="muted">{q.name}</span>
											<span>{q.options[decision.answers[q.id]]?.label}</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if decision.type !== 'read'}
								<p class="ui-code mt-3">
									{@html decision.type === 'approve' ? doc.approve : doc.sendback}
								</p>
							{/if}
							<p class="mt-4">
								<button class="btn btn-sm" disabled={busy} onclick={undo}>
									{decision.type === 'approve'
										? 'Undo the approval'
										: decision.type === 'sendback'
											? 'Undo the send-back'
											: 'Mark as unread'}
								</button>
							</p>
						{:else if report}
							<h2>This report has no questions.</h2>
							<p class="mt-1 muted">Mark it as read to take it off your list. The session gets any notes you leave either way.</p>
							<p class="mt-4">
								<button class="btn btn-primary" disabled={busy} onclick={() => decide('read')}>Mark as read</button>
							</p>
						{:else}
							{#if questions.length}
								<h2>Your answers</h2>
								<ul class="answers mt-2">
									{#each questions as q (q.id)}
										{@const r = recommended(q)}
										<li>
											<span class="muted">{q.name}</span>
											<span>
												{#if picks[q.id] === undefined}
													<span class="text-error">Not answered yet</span>
												{:else}
													{q.options[picks[q.id]].label}{#if r >= 0 && picks[q.id] !== r}{' '}<span class="muted">(not the recommended answer)</span>{/if}
												{/if}
											</span>
										</li>
									{/each}
								</ul>
							{/if}
							<div class="mt-5 grid gap-5">
								<div>
									<button class="btn btn-primary" disabled={busy || answered < questions.length} onclick={() => decide('approve')}>
										{questions.length ? 'Approve with the answers selected above' : 'Approve'}
									</button>
									<p class="ui-code mt-2">{@html doc.approve}</p>
								</div>
								<div>
									<button class="btn" disabled={busy} onclick={() => decide('sendback')}>Send back with my notes</button>
									<p class="ui-code mt-2">{@html doc.sendback}</p>
									<p class="mt-1 muted">
										{#if myNotes}
											You have {plural(myNotes, 'note').toLowerCase()} waiting for an answer.
										{:else}
											You have no notes waiting for an answer. To write one, select any words in the document.
										{/if}
									</p>
								</div>
							</div>
						{/if}
						{#if unsent}
							<div role="alert" class="alert alert-error mt-4 block">
								<p><strong class="font-semibold">The queue isn't running.</strong> {unsent}</p>
							</div>
						{/if}
					</section>
				{/if}
			{/each}
		</div>
	</article>
</Annotated>

