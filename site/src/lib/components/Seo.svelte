<script lang="ts">
	import { page } from '$app/state';
	import { graph, serializeJsonLd, type PageInput } from '#lib/seo/json-ld.js';
	import { metaFor } from '#lib/seo/meta.js';
	import { OG_IMAGE, SITE } from '#lib/site.js';

	let {
		kind,
		section,
		name,
		faq
	}: Pick<PageInput, 'kind' | 'section' | 'name' | 'faq'> = $props();

	const path = $derived(page.url.pathname);
	const meta = $derived(metaFor(path));
	const canonical = $derived(path === '/' ? SITE.url : SITE.url + path);
	const jsonLd = $derived(
		serializeJsonLd(graph({ path, title: meta.title, description: meta.description, kind, section, name, faq }))
	);
</script>

<svelte:head>
	<title>{meta.title}</title>
	<meta name="description" content={meta.description} />
	<link rel="canonical" href={canonical} />

	<meta property="og:type" content={kind === 'article' ? 'article' : 'website'} />
	<meta property="og:site_name" content={SITE.name} />
	<meta property="og:locale" content="en_US" />
	<meta property="og:title" content={meta.title} />
	<meta property="og:description" content={meta.description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={OG_IMAGE.url} />
	<meta property="og:image:width" content={String(OG_IMAGE.width)} />
	<meta property="og:image:height" content={String(OG_IMAGE.height)} />
	<meta property="og:image:alt" content={OG_IMAGE.alt} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={meta.title} />
	<meta name="twitter:description" content={meta.description} />
	<meta name="twitter:image" content={OG_IMAGE.url} />
	<meta name="twitter:image:alt" content={OG_IMAGE.alt} />

	<!-- A data block, not a script: the CSP does not apply, and serializeJsonLd escapes "<". -->
	{@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>
