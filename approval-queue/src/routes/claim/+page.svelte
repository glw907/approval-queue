<!-- @component
The confirmation `/claim` shows after the server sets the claim cookie. The page holds no state: the
cookie is the whole effect, and visiting again only renews it.
-->
<svelte:head><title>This browser is claimed · Approval Queue</title></svelte:head>

<main id="main" tabindex="-1" class="flex-1 px-5 pt-16 lg:px-8">
	<div class="max-w-[60ch]">
		<h1 class="desk-title text-[1.6rem] leading-tight">This browser is claimed</h1>
		<p class="mt-2">
			New items open in this browser, and only its open tab counts as yours. A browser an agent drives does not.
		</p>
		<p class="desk-muted mt-4 text-sm">Visit this page again in any browser that should take over.</p>
	</div>
</main>
