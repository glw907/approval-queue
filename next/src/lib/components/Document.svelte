<!--
@component
One document from a session: its header, its text with each question asked where the text raises
it, and the decision. The reader can select an answer, and each question starts on its
recommended one. The decide buttons are drawn and record nothing; pass A4 makes them work.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Annotated from './Annotated.svelte';
	import { DOC } from '#lib/strings.ts';
	import type { PageDoc } from '#lib/components/types.ts';
	import type { Segment } from '#lib/doc/types.ts';

	let { doc }: { doc: PageDoc } = $props();

	type Question = Extract<Segment, { type: 'question' }>;
	const questions = $derived(doc.segments.filter((s): s is Question => s.type === 'question'));
	const recommended = (q: Question) => q.options.findIndex((o) => o.recommended);

	// The page keys this component on the document's id, so the first document's answers are the
	// only ones it holds.
	const picks: Record<string, number | undefined> = $state(
		untrack(() => Object.fromEntries(questions.map((q) => [q.id, recommended(q) >= 0 ? recommended(q) : undefined])))
	);
	const answered = $derived(questions.filter((q) => picks[q.id] !== undefined).length);
	const report = $derived(doc.kind === 'report');
</script>

<Annotated>
	<article>
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
					<fieldset class="question">
						<legend class="sr-only">{seg.label}</legend>
						{#each seg.options as o, i (i)}
							<label class="question-option">
								<input
									type="radio"
									class="radio radio-sm radio-primary"
									name="{doc.id}-{seg.id}"
									value={i}
									bind:group={picks[seg.id]}
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
				{:else}
					<section class="decide" data-no-notes aria-label={DOC.decision}>
						{#if report}
							<h2>{DOC.reportHeading}</h2>
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
							<div class="mt-5 grid gap-5">
								<div>
									<button type="button" class="btn btn-primary" disabled={answered < questions.length}>
										{questions.length ? DOC.approveWithAnswers : DOC.approve}
									</button>
									{#if doc.approve}<p class="ui-code mt-2">{@html doc.approve}</p>{/if}
								</div>
								<div>
									<button type="button" class="btn">{DOC.sendBack}</button>
									{#if doc.sendback}<p class="ui-code mt-2">{@html doc.sendback}</p>{/if}
									<p class="mt-1 muted">{DOC.noNotesWaiting}</p>
								</div>
							</div>
						{/if}
					</section>
				{/if}
			{/each}
		</div>
	</article>
</Annotated>
