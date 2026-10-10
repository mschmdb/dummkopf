"""Text and JSON output for read packets, always within the --max-chars budget."""

from __future__ import annotations

import copy
import json

from dummkopf.messages import text as say
from dummkopf.search import Packet, SourceLine

SEARCH_LINE_BUDGET = 900


def render(packet: Packet, as_json: bool, tone: str) -> str:
    if as_json:
        return json.dumps(packet, ensure_ascii=False, separators=(",", ":")) + "\n"
    output: list[str] = []
    if "period" in packet:
        output.append(say("out_period", tone, start=packet["period"]["start"], end=packet["period"]["end"]))
    if not packet["hits"]:
        output.append(say("no_results", tone))
    if packet["match"] == "partial":
        output.append(say("out_partial", tone))
    if packet.get("ignored"):
        output.append(say("out_ignored", tone, terms=", ".join(packet["ignored"])))
    if packet.get("missing"):
        output.append(say("out_not_found", tone, terms=", ".join(packet["missing"])))
    for hit in packet["hits"]:
        output.append(f"{hit['path']} | rev={hit['revision'][:12]} | updated={hit['updated'] or '?'} | "
                      f"status={hit['status'] or '?'} | scope={hit['scope']}")
        if hit["key_fact"]:
            output.append(say("out_key_fact", tone, text=hit["key_fact"]))
        output.extend(f"{line['n']}: {line['text']}" for line in hit["lines"])
        output.append("")
    if packet["more"]:
        output.append(say("out_more", tone))
    if packet["truncated"]:
        output.append(say("out_truncated", tone))
    if packet.get("missing_dates"):
        output.append(say("out_missing_dates", tone, dates=", ".join(packet["missing_dates"])))
    return "\n".join(output).rstrip() + "\n"


def bounded(packet: Packet, max_chars: int, as_json: bool, tone: str) -> str:
    packet = copy.deepcopy(packet)
    for hit in packet["hits"]:
        # Search hits stay short; direct reads use the whole requested budget.
        remaining = max_chars if packet["match"] in ("direct", "routed") else SEARCH_LINE_BUDGET
        kept: list[SourceLine] = []
        for line in hit["lines"]:
            if remaining <= 0:
                packet["truncated"] = True
                break
            text = line["text"]
            if len(text) > remaining:
                text = text[:max(0, remaining - 1)] + "…"
                packet["truncated"] = True
            kept.append(SourceLine(n=line["n"], text=text))
            remaining -= len(text)
        hit["lines"] = kept
    while len(render(packet, as_json, tone)) > max_chars:
        packet["truncated"] = True
        # Trim search hints before sources; the first term (or its start) stays visible.
        if len(packet.get("ignored", [])) > 1:
            packet["ignored"].pop()
            continue
        if len(packet.get("missing", [])) > 1:
            packet["missing"].pop()
            continue
        if packet.get("ignored") and len(packet["ignored"][0]) > 32:
            packet["ignored"][0] = packet["ignored"][0][:31] + "…"
            continue
        if packet.get("missing") and len(packet["missing"][0]) > 32:
            packet["missing"][0] = packet["missing"][0][:31] + "…"
            continue
        if len(packet["hits"]) > 1:
            packet["hits"].pop()
            packet["more"] = True
            continue
        if not packet["hits"]:
            break
        hit = packet["hits"][0]
        if len(hit["lines"]) > 1:
            hit["lines"].pop()
        elif hit["lines"] and len(hit["lines"][0]["text"]) > 30:
            text = hit["lines"][0]["text"]
            excess = len(render(packet, as_json, tone)) - max_chars
            hit["lines"][0]["text"] = text[:max(20, len(text) - max(excess, 10) - 1)] + "…"
        elif hit["key_fact"]:
            hit["key_fact"] = ""
        elif hit["title"]:
            hit["title"] = ""
        else:
            packet["hits"] = []
            break
    return render(packet, as_json, tone)
