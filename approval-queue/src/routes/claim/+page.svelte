<!-- @component
The `/claim` page. It shows "Claim this browser" until the browser carries the claim cookie, and a
confirmation after. Loading the page sets nothing; only pressing the button posts the default action,
which sets the cookie.
-->
<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const claimed = $derived(data.claimed || form?.claimed === true);
</script>

<svelte:head><title>{claimed ? 'This browser is claimed' : 'Claim this browser'} · Approval Queue</title></svelte:head>

<main id="main" tabindex="-1" class="flex-1 px-5 pt-6 lg:px-8">
	<div class="max-w-[60ch]">
		{#if claimed}
			<h1 class="desk-title text-[1.6rem] leading-tight">This browser is claimed</h1>
			<p class="mt-2">
				New items open in this browser, and only its open tab counts as yours. A browser an agent drives does not.
			</p>
			<p class="desk-muted mt-4 text-sm">Open this page in any browser that should take over, and press the button.</p>
		{:else}
			<h1 class="desk-title text-[1.6rem] leading-tight">Claim this browser</h1>
			<p class="mt-2">
				New items open in the browser you claim, and only its open tab counts as yours. A browser an agent drives does not.
			</p>
			<form method="POST" class="mt-4">
				<button class="btn btn-primary">Claim this browser</button>
			</form>
		{/if}
	</div>
</main>
