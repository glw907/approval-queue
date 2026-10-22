<!-- @component
One packet verdict as a joined segment of radio buttons: the options a step or part takes, with the
session's verdict preselected and a changed pick shown in amber. The radios belong to the decision
form (`form="decision-form"`) and post as `part:<ref>`; `verdicts` is bound up so the page can
follow what changed.
-->
<script lang="ts">
	import { VERDICT_LOOK, overrideOptions } from '#lib/packet-view.ts';

	interface Props {
		/** The part's canonical ref, which names the radio group. */
		ref: string;
		/** `pr`, `design`, or `step`; a step takes different options. */
		kind: string;
		/** The session's verdict, which the group starts on. */
		session: string;
		/** What the group is called to assistive technology. */
		label: string;
		/** The verdict chosen for each part, by ref. */
		verdicts: Record<string, string>;
		/** A decided packet shows its verdicts but locks every one. */
		decided: boolean;
	}

	let { ref, kind, session, label, verdicts = $bindable({}), decided }: Props = $props();
</script>

<div class={['join seg', verdicts[ref] !== session && 'changed']} role="radiogroup" aria-label={label}>
	{#each overrideOptions(kind, session) as option (option)}
		<input
			class="join-item btn btn-sm"
			type="radio"
			name="part:{ref}"
			value={option}
			form="decision-form"
			aria-label={VERDICT_LOOK[option].short}
			disabled={decided}
			bind:group={verdicts[ref]}
		/>
	{/each}
</div>
