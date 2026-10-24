<script lang="ts">
	import { SITE } from '#lib/site.js';
</script>

<svelte:head>
	<title>{SITE.title}</title>
	<meta name="description" content={SITE.description} />
	<link rel="canonical" href={SITE.url} />
</svelte:head>

<section class="max-w-3xl">
	<h1 class="text-4xl font-semibold tracking-tight text-ink">rcllr</h1>
	<p class="mt-4 text-xl text-ink-muted">
		rcllr is a CLI that gives coding agents like Claude Code and Codex long-term memory, stored as Markdown notes in a
		plain Git repo.
	</p>
	<pre class="mt-8 overflow-x-auto rounded-md border border-rule bg-bg-elevated p-4 font-mono text-sm"><code
			>npm install -g rcllr</code
		></pre>
</section>
