<!-- @component
A PR part's files in a packet. A part whose head moved since Geoff sent the packet back shows
"Changes since you sent it back" with the same grouping, then the full list as "All files"; a part
whose old head is no longer in the branch says so and shows the full list alone. A part with no
`since` shows the one Files row it always did.
-->
<script lang="ts">
	import { filesLine } from '#lib/packet-view.ts';

	type Groups = Array<{ name: string; files: unknown[] }>;

	interface Props {
		groups: Groups;
		/** Left out for a part that was not sent back. */
		since?: { groups: Groups } | { gone: true };
	}

	let { groups, since }: Props = $props();
</script>

<dl class="mt-1 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 text-[0.85rem]">
	{#if since}
		<dt class="col-span-2 font-semibold">Changes since you sent it back</dt>
		{#if 'groups' in since}
			<dd class="col-span-2 tabular-nums">{filesLine(since.groups)}</dd>
		{:else}
			<dd class="col-span-2">The commit you sent back is no longer in this branch, so only the full file list follows.</dd>
		{/if}
	{/if}
	<dt>{since ? 'All files' : 'Files'}</dt>
	<dd class="tabular-nums">{filesLine(groups)}</dd>
</dl>
