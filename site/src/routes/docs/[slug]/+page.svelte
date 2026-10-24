<script lang="ts">
	import DocsShell from '#lib/components/DocsShell.svelte';
	import Seo from '#lib/components/Seo.svelte';

	let { data } = $props();
</script>

<Seo kind="article" section="Docs" name={data.page.title} />

<DocsShell headings={data.page.headings}>
	<h1 class="text-3xl font-semibold tracking-tight">{data.page.title}</h1>
	<div class="prose-rcllr mt-6">{@html data.page.html}</div>
</DocsShell>
