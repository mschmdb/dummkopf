<script lang="ts">
	import Seo from '#lib/components/Seo.svelte';
	import { version } from '#lib/content/index.js';
	import { FAQ, FEATURES, NEEDS, STEPS } from '#lib/landing.js';
	import { SITE } from '#lib/site.js';

	/** Inline `code` in the plain-text answers. */
	function withCode(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/`([^`]+)`/g, '<code class="font-mono text-[0.9em]">$1</code>');
	}
</script>

<Seo kind="home" faq={FAQ} />

<section class="max-w-3xl py-6">
	<h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">rcllr: one memory for all your coding agents</h1>
	<p class="mt-6 text-xl text-ink-muted">
		What Claude Code learns, Codex knows too. rcllr (say “recaller”) is a CLI that gives your coding agents one shared long-term
		memory: Markdown notes in a Git repo you own.
	</p>
	<pre class="mt-8"><code>npm install -g rcllr</code></pre>
	<p class="mt-2 text-sm text-ink-subtle">Version {version}, MIT licensed.</p>
	<div class="mt-6 flex flex-wrap gap-3">
		<a
			href="/docs/quickstart-5-minutes"
			class="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-medium text-bg hover:opacity-90"
			>Quickstart in 5 minutes</a
		>
		<a
			href={SITE.repo}
			class="inline-flex min-h-11 items-center rounded-md border border-rule-strong px-4 text-ink hover:bg-bg-elevated"
			>Source on GitHub</a
		>
	</div>
</section>

<section aria-labelledby="how" class="mt-16 max-w-3xl">
	<h2 id="how" class="text-2xl font-semibold">From one agent to the next</h2>
	<ol class="mt-6 space-y-8">
		{#each STEPS as step, index (step.title)}
			<li class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
				<span class="text-2xl font-semibold text-ink-subtle" aria-hidden="true">{index + 1}</span>
				<div>
					<h3 class="text-lg font-semibold">{step.title}</h3>
					<p class="mt-1 text-ink-muted">{step.text}</p>
					{#if step.code}
						<pre class="mt-3"><code>{step.code}</code></pre>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
</section>

<section aria-labelledby="features" class="mt-16">
	<h2 id="features" class="text-2xl font-semibold">What else rcllr does</h2>
	<ul class="mt-6 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
		{#each FEATURES as feature (feature.title)}
			<li class="border-t border-rule py-5">
				<h3 class="font-semibold">{feature.title}</h3>
				<p class="mt-2 text-ink-muted">{feature.text}</p>
			</li>
		{/each}
	</ul>
</section>

<section aria-labelledby="needs" class="mt-16 max-w-3xl">
	<h2 id="needs" class="text-2xl font-semibold">What you need</h2>
	<ul class="mt-4 list-disc space-y-1 pl-6 text-ink-muted">
		{#each NEEDS as need (need)}
			<li>{need}</li>
		{/each}
	</ul>
	<p class="mt-4 text-ink-muted">
		New to the terminal? The <a href="/docs/quickstart-5-minutes" class="text-accent underline underline-offset-4"
			>quickstart</a
		> shows every command to type.
	</p>
</section>

<section aria-labelledby="faq" class="mt-16 max-w-3xl">
	<h2 id="faq" class="text-2xl font-semibold">Questions</h2>
	<div class="mt-6 divide-y divide-rule border-y border-rule">
		{#each FAQ as item (item.question)}
			<div class="py-5">
				<h3 class="font-semibold">{item.question}</h3>
				<p class="mt-2 text-ink-muted">{@html withCode(item.answer)}</p>
				{#if item.link}
					<p class="mt-2"><a href={item.link.href} class="text-accent underline underline-offset-4">{item.link.label}</a></p>
				{/if}
			</div>
		{/each}
	</div>
</section>
