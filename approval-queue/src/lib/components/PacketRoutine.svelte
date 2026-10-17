<!-- @component
The routine table: one row per part no ask binds, each with its verdict shown as text, icon, and
color, and a two- or three-option override. The session's verdict is preselected; an overridden row
takes a left rule. A part's detail (a PR's checks and files, or the design doc) opens behind a
disclosure whose summary states the verdict-changing fact, except that a failing or unchecked part
keeps that fact outside it.

The override radios belong to the decision form and post as `part:<ref>`; `verdicts` is bound up so
the page can follow what changed. The server reads every routine part by ref and refuses a post that
omits one. Renders nothing for a packet with no routine rows.
-->
<script lang="ts">
	import { desk } from '#lib/desk.svelte.ts';
	import { VERDICT_LOOK, overrideOptions, refKind } from '#lib/packet-view.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import PacketIcon from './PacketIcon.svelte';
	import Prose from './Prose.svelte';

	type Packet = Extract<PageData, { kind: 'packet' }>;

	interface Props {
		routine: Packet['routine'];
		/** Every part, which carries the detail a row opens to. */
		parts: Packet['parts'];
		/** The verdict chosen for each part, by ref; starts at the session's. */
		verdicts: Record<string, string>;
		/** A decided packet shows its rows but locks every override. */
		decided: boolean;
	}

	let { routine, parts, verdicts = $bindable({}), decided }: Props = $props();

	const detail = (ref: string) => parts.find((p) => p.ref === ref);
	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

	/** A PR with a failing check or a review that asks for a fix is failing; one with neither run is unchecked. */
	function flag(part: ReturnType<typeof detail>): 'failing' | 'unchecked' | null {
		if (part?.kind !== 'pr') return null;
		if ((part.checks?.failed ?? 0) > 0 || part.review === 'fix' || part.review === 'escalate') return 'failing';
		return (part.checks?.rows.length ?? 0) === 0 || !part.review ? 'unchecked' : null;
	}

	const changed = $derived(routine.filter((row) => verdicts[row.ref] !== row.verdict).length);
</script>

{#if routine.length}
	<section id="routine" aria-labelledby="routine-h" class="mt-8">
		<div class="flex flex-wrap items-baseline gap-x-3">
			<h2 id="routine-h" class="section-h">Routine</h2>
			<span class="text-sm desk-muted">
				{routine.length} {plural(routine.length, 'part', 'parts')}, the session’s verdicts preselected{changed ? `, ${changed} changed` : ''}
			</span>
		</div>
		<div class="mt-2 overflow-x-auto">
			<table class="table routine-table">
				<thead>
					<tr>
						<th scope="col">Part</th>
						<th scope="col" class="w-40">Verdict</th>
						<th scope="col" class="w-60 text-right">Change</th>
					</tr>
				</thead>
				<tbody>
					{#each routine as row (row.ref)}
						{@const part = detail(row.ref)}
						{@const flagged = flag(part)}
						{@const look = VERDICT_LOOK[verdicts[row.ref]]}
						<tr class={['part-row', verdicts[row.ref] !== row.verdict && 'is-changed']}>
							<td class="part-cell align-top">
								<div class="flex flex-wrap items-center gap-x-2 text-[0.8rem] desk-muted">
									<span>{refKind(row.ref)}</span><span class="font-mono">{row.ref}</span>
								</div>
								{#if flagged}
									<p class={['mt-1 flex items-start gap-1.5 text-sm', flagged === 'failing' ? 'tone-error' : 'tone-warning']}>
										<PacketIcon name={flagged === 'failing' ? 'gate' : 'eyeoff'} class="mt-0.5 size-4" />
										<span><strong>{flagged === 'failing' ? 'Failing.' : 'Unchecked.'}</strong> <Prose text={row.fact} /></span>
									</p>
								{/if}
								<details class="part-detail mt-1">
									<summary class="flex min-h-8 cursor-pointer items-start gap-1.5 text-sm desk-muted">
										<PacketIcon name="chev" class="chev mt-[0.15rem] size-4" />
										<span><Prose text={flagged ? 'Detail' : row.fact} /></span>
									</summary>
									<div class="detail-body mt-1 mb-1 ms-5.5 max-w-[56ch] text-sm leading-relaxed">
										<p><Prose text={row.why} /></p>
										{#if part?.kind === 'pr'}
											{#if part.link}
												<p class="mt-1 desk-muted">
													{part.link.head} → {part.link.base} ·
													<a class="link" href={part.link.url} target="_blank" rel="noopener noreferrer">GitHub</a>
												</p>
											{/if}
											<dl class="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[0.85rem]">
												<dt class="desk-muted">Checks</dt>
												<dd>{part.checks?.text ?? 'None.'}</dd>
												<dt class="desk-muted">Review</dt>
												<dd>{part.review ?? 'Not stated.'}</dd>
												<dt class="desk-muted">Files</dt>
												<dd class="tabular-nums">
													{part.groups?.reduce((n, g) => n + g.files.length, 0) ?? 0} in {part.groups?.length ?? 0}
													{plural(part.groups?.length ?? 0, 'group', 'groups')}:
													{part.groups?.map((g) => g.name).join(', ')}
												</dd>
											</dl>
										{:else if part?.kind === 'design' && part.doc}
											<!-- svelte-ignore a11y_no_noninteractive_tabindex: a sideways-scrolling excerpt needs the keyboard to reach it -->
											<pre class="evidence-code mt-2" role="region" tabindex="0" aria-label="The design, scrolls sideways"><code>{part.doc}</code></pre>
										{/if}
									</div>
								</details>
							</td>
							<td class="verdict-cell align-top">
								<span class={['inline-flex items-center gap-1.5 font-semibold', look.ink]}>
									<PacketIcon name={look.icon} />{look.label}
								</span>
								{#if verdicts[row.ref] !== row.verdict}<span class="sr-only">, changed from {VERDICT_LOOK[row.verdict].label}</span>{/if}
							</td>
							<td class="change-cell align-top text-right">
								<div class="join override" role="radiogroup" aria-label="Verdict for {row.ref}">
									{#each overrideOptions(row.kind, row.verdict) as option (option)}
										<input
											class="join-item btn btn-sm"
											type="radio"
											name="part:{row.ref}"
											value={option}
											form="decision-form"
											aria-label={VERDICT_LOOK[option].short}
											title={VERDICT_LOOK[option].label}
											disabled={desk.held || decided}
											bind:group={verdicts[row.ref]}
										/>
									{/each}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}
