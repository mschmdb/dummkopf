import assert from "node:assert/strict";
import { test } from "node:test";

import { breadcrumbs, graph, PERSON_ID, SOFTWARE_ID, serializeJsonLd, WEBSITE_ID } from "./json-ld.ts";

const types = (data: { "@graph": Record<string, unknown>[] }) => data["@graph"].map((node) => node["@type"]);

test("every page carries the site, the software and its author", () => {
  const data = graph({ path: "/changelog", title: "T", description: "D", kind: "page" });
  assert.equal(data["@context"], "https://schema.org");
  assert.deepEqual(types(data).slice(0, 3), ["WebSite", "SoftwareApplication", "Person"]);
  const software = data["@graph"][1] as Record<string, unknown>;
  assert.deepEqual(software.author, { "@id": PERSON_ID });
  assert.ok(String(software.softwareVersion).match(/^\d+\.\d+\.\d+$/));
});

test("the author is the same entity as on schmidbauer.dev", () => {
  assert.equal(PERSON_ID, "https://schmidbauer.dev/#person");
});

test("the home page adds a web page about the software and the FAQ", () => {
  const data = graph({ path: "/", title: "T", description: "D", kind: "home", faq: [{ question: "Q?", answer: "A `x`." }] });
  assert.deepEqual(types(data).slice(3), ["WebPage", "FAQPage"]);
  const faq = data["@graph"][4] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  assert.equal(faq.mainEntity[0]!.name, "Q?");
  assert.equal(faq.mainEntity[0]!.acceptedAnswer.text, "A x.");
});

test("a doc page is a tech article about the software, with breadcrumbs", () => {
  const data = graph({ path: "/docs/faq", title: "FAQ", description: "D", kind: "article", section: "Docs" });
  assert.deepEqual(types(data).slice(3), ["TechArticle", "BreadcrumbList"]);
  const article = data["@graph"][3] as Record<string, unknown>;
  assert.deepEqual(article.about, { "@id": SOFTWARE_ID });
  assert.deepEqual(article.isPartOf, { "@id": WEBSITE_ID });
  assert.equal(article.url, "https://rcllr.schmidbauer.dev/docs/faq");
});

test("breadcrumbs run from home to the page", () => {
  const list = breadcrumbs("/commands/write", "rcllr write", "Commands");
  assert.deepEqual(list.itemListElement.map((item) => [item.position, item.name, item.item]), [
    [1, "rcllr", "https://rcllr.schmidbauer.dev"],
    [2, "Commands", "https://rcllr.schmidbauer.dev/commands"],
    [3, "rcllr write", "https://rcllr.schmidbauer.dev/commands/write"],
  ]);
});

test("serialized JSON-LD cannot close its script tag", () => {
  assert.equal(serializeJsonLd({ a: "</script>" }), '{"a":"\\u003c/script>"}');
});
