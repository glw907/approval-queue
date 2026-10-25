<!-- @component
What a PR part changed since Geoff sent the packet back: "Changes since you sent it back" with the
same grouping `FilesDiff` uses, or a note that the old head is no longer in the branch. It sits above
the part's full `FilesDiff`. Renders nothing for a part that was not sent back.
-->
<script lang="ts">
	import { filesLine } from '#lib/packet-view.ts';

	interface Props {
		since?: { groups: Array<{ name: string; files: unknown[] }> } | { gone: true };
	}

	let { since }: Props = $props();
</script>

{#if since}
	<dl class="mt-1 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 text-[0.85rem]">
		<dt class="col-span-2 font-semibold">Changes since you sent it back</dt>
		{#if 'groups' in since}
			<dd class="col-span-2 tabular-nums">{filesLine(since.groups)}</dd>
		{:else}
			<dd class="col-span-2">The commit you sent back is no longer in this branch, so only the full file list follows.</dd>
		{/if}
	</dl>
{/if}
