<script lang="ts">
	import DocsShell from '#lib/components/DocsShell.svelte';
	import { changelog } from '#lib/content/index.js';
	import Seo from '#lib/components/Seo.svelte';
</script>

<Seo kind="page" name="Changelog" />

<DocsShell headings={changelog.headings.filter((heading) => heading.depth === 2)}>
	<h1 class="text-3xl font-semibold tracking-tight">Changelog</h1>
	<div class="prose-rcllr mt-6">{@html changelog.html}</div>
</DocsShell>
