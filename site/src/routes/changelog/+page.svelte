<script lang="ts">
	import DocsShell from '#lib/components/DocsShell.svelte';
	import { changelog } from '#lib/content/index.js';
	import { SITE } from '#lib/site.js';
</script>

<svelte:head>
	<title>Changelog · {SITE.name}</title>
	<meta name="description" content="Every change to rcllr, release by release." />
</svelte:head>

<DocsShell headings={changelog.headings.filter((heading) => heading.depth === 2)}>
	<h1 class="text-3xl font-semibold tracking-tight">Changelog</h1>
	<div class="prose-rcllr mt-6">{@html changelog.html}</div>
</DocsShell>
