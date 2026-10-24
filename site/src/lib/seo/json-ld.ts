// Structured data for every page: one @graph with stable @ids, so search engines see one site, one software and
// one author. The author's @id is the Person on schmidbauer.dev, which links both sites to the same entity.

import { version } from "../content/index.ts";
import { OG_IMAGE, SITE } from "../site.ts";

export type JsonLd = Record<string, unknown>;

export const WEBSITE_ID = SITE.url + "/#website";
export const SOFTWARE_ID = SITE.url + "/#software";
export const PERSON_ID = SITE.author.url + "/#person";

const ref = (id: string) => ({ "@id": id });
const absolute = (path: string) => (path === "/" ? SITE.url : SITE.url + path);

/** Section pages that exist as their own URL, so a breadcrumb can link to them. */
const SECTIONS: Record<string, string> = { Commands: "/commands" };

function website(): JsonLd {
  return {
    "@type": "WebSite", "@id": WEBSITE_ID, url: SITE.url, name: SITE.name, description: SITE.description,
    inLanguage: "en", publisher: ref(PERSON_ID), about: ref(SOFTWARE_ID),
  };
}

function software(): JsonLd {
  return {
    "@type": "SoftwareApplication", "@id": SOFTWARE_ID, name: SITE.name, description: SITE.description,
    url: SITE.url, image: OG_IMAGE.url, applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Long-term memory for coding agents", operatingSystem: "macOS, Linux, Windows",
    softwareVersion: version, softwareRequirements: "Node.js 22.18 or newer, Git",
    downloadUrl: SITE.npm, installUrl: SITE.url + "/docs/quickstart-5-minutes",
    license: "https://opensource.org/licenses/MIT", sameAs: [SITE.repo, SITE.npm],
    author: ref(PERSON_ID), offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };
}

function person(): JsonLd {
  return { "@type": "Person", "@id": PERSON_ID, name: SITE.author.name, url: SITE.author.url };
}

export function breadcrumbs(path: string, name: string, section?: string) {
  const trail: [string, string][] = [[SITE.name, "/"]];
  const sectionPath = section ? SECTIONS[section] : undefined;
  if (section && sectionPath && sectionPath !== path) trail.push([section, sectionPath]);
  trail.push([name, path]);
  return {
    "@type": "BreadcrumbList" as const,
    itemListElement: trail.map(([label, href], index) => ({
      "@type": "ListItem" as const, position: index + 1, name: label, item: absolute(href),
    })),
  };
}

export interface PageInput {
  path: string;
  title: string;
  description: string;
  /** home: the landing page. article: a doc or command page. page and collection: other pages. */
  kind: "home" | "article" | "page" | "collection";
  /** Breadcrumb label of the section, e.g. "Commands". */
  section?: string;
  /** Short name for the breadcrumb; defaults to the title. */
  name?: string;
  faq?: readonly { question: string; answer: string }[];
}

export function graph(input: PageInput): { "@context": string; "@graph": JsonLd[] } {
  const url = absolute(input.path);
  const page = {
    "@id": url + "#webpage", url, name: input.title, description: input.description, inLanguage: "en",
    isPartOf: ref(WEBSITE_ID), about: ref(SOFTWARE_ID),
  };
  const nodes: JsonLd[] = [website(), software(), person()];
  if (input.kind === "home") {
    nodes.push({ "@type": "WebPage", ...page, primaryImageOfPage: OG_IMAGE.url });
    if (input.faq?.length) {
      nodes.push({
        "@type": "FAQPage", "@id": url + "#faq", isPartOf: ref(url + "#webpage"),
        mainEntity: input.faq.map((item) => ({
          "@type": "Question", name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer.replace(/`/g, "") },
        })),
      });
    }
    return { "@context": "https://schema.org", "@graph": nodes };
  }
  if (input.kind === "article") {
    nodes.push({
      "@type": "TechArticle", ...page, headline: input.title, mainEntityOfPage: url, image: OG_IMAGE.url,
      author: ref(PERSON_ID), publisher: ref(PERSON_ID),
    });
  } else {
    nodes.push({ "@type": input.kind === "collection" ? "CollectionPage" : "WebPage", ...page });
  }
  nodes.push(breadcrumbs(input.path, input.name ?? input.title, input.section));
  return { "@context": "https://schema.org", "@graph": nodes };
}

/** JSON for a `<script type="application/ld+json">`; `<` is escaped, so the content cannot close the tag. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
