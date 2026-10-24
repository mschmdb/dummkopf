<script lang="ts">
	import DocsShell from '#lib/components/DocsShell.svelte';
	import { SITE } from '#lib/site.js';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.page.title} · {SITE.name}</title>
	<meta name="description" content={data.page.text.slice(0, 155)} />
</svelte:head>

<DocsShell headings={data.page.headings}>
	<h1 class="text-3xl font-semibold tracking-tight">{data.page.title}</h1>
	<div class="prose-rcllr mt-6">{@html data.page.html}</div>
</DocsShell>
