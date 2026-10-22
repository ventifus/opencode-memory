---
name: mempalace-memory
description: How to use MemPalace memory from OpenCode when the opencode-memory plugin is installed — tool name prefixes, the wing/room layout this plugin writes to, the shared "agent" identity, when to search before answering, and what to write yourself (the plugin only captures the raw transcript and compaction summaries automatically; it does not search, recall, or journal on your behalf). Load this whenever working in a project that has mempalace available, or when asked what was decided/done before, who someone is, or what happened in a prior session.
---

# MemPalace memory (opencode-memory plugin)

This plugin's job is narrow and entirely automatic: it captures your raw
conversation transcript and OpenCode's own compaction summaries into
MemPalace, verbatim, without you having to remember to do it. It does
**not** search memory for you, and it does **not** write to your diary or
the knowledge graph on your behalf — those require your judgment, and
this skill explains when and how to do them.

## Tool name prefix

OpenCode registers the MemPalace MCP server as `mempalace`, so every tool
carries a double prefix: `mempalace_mempalace_search`,
`mempalace_mempalace_kg_query`, `mempalace_mempalace_diary_write`, and so
on — not the single `mempalace_` prefix used in some other integrations.
If a call fails with "unknown tool," check the prefix first.

## What's already being captured for you (no action needed)

- **Every exchange, verbatim** — `wing_<project>` (one wing per project
  directory you're working in), room `conversations`. This is the
  reliable floor: nothing you discuss is ever lost to this, regardless of
  whether you follow the rest of this skill.
- **OpenCode's own compaction summaries** — whenever a session compacts
  (automatically or via `/compact`), the resulting summary (Objective /
  Decisions / Work State / Relevant Files / etc.) is filed to
  `wing_agent`, room `session-summaries`. This happens whether or not you
  do anything.

Neither of these needs a tool call from you. They exist specifically so
that nothing depends on you remembering to checkpoint.

## What's genuinely your job

### 1. Recall before answering

Before answering something that may already be filed in memory — past
decisions, a person, a project, "what did we do last time," a preference
that could have changed — search first instead of guessing from model
memory:

- `mempalace_mempalace_search` — general semantic search over verbatim
  content. Pass `wing` to scope to one project, or omit it to search the
  whole palace (useful when work may be related to a different project
  you've worked on before).
- `mempalace_mempalace_kg_query` — for relational or time-bound facts
  ("who is X", "what does Y depend on", "was this ever true").
- `mempalace_mempalace_diary_read` with `agent_name: "agent"` — your own
  cross-session journal. Read this when you want a sense of continuity
  ("what have I generally been doing/learning lately"), not for
  project-specific facts.

Don't search reflexively on every turn — it's question-driven. Pure
greenfield work with no memory relevance ("rename this variable") doesn't
need it.

When you do find something, quote the drawer's content verbatim. Don't
paraphrase or summarize stored memory back to the user — the exact
wording is the point.

### 2. Write durable facts to the knowledge graph as they come up

When you notice something worth remembering permanently — a decision, a
milestone, a stated preference, a resolved problem — call
`mempalace_mempalace_kg_add` (subject/predicate/object, object 128
characters or fewer). Do this as it happens, not just when reminded; the
periodic reminder you'll sometimes see injected into context is a
backstop, not the only trigger.

### 3. Write a diary entry, sparingly

`mempalace_mempalace_diary_write` is your own reflective journal — "what
you worked on, what you noticed, what you think matters" — not a
transcript (that's already captured automatically) and not a session
status report (that's the compaction summary, also automatic). Write one
when something is genuinely worth remembering across sessions and
projects, typically near the natural end of a session, not on every
nudge.

**Always use:**
- `agent_name: "agent"` — a single shared identity across every tool,
  every OpenCode instance, every session, by design. There is no reason
  to use anything else: using two tools (or two instances of the same
  tool) concurrently is no more a reason to fragment identity than using
  one tool twice in a row. If you ever use a different coding tool
  against this same palace, configure it to use `"agent"` too — same
  journal, not a new one.
- `topic:` set to the current project (the same name the project's
  `wing_<project>` uses, without the `wing_` prefix). The diary itself is
  one shared, cross-project stream — `topic` is how a later read
  (yours or a different concurrent session's) can tell at a glance which
  project a given entry came from, since several sessions across
  different projects may be writing to it around the same time.

**A diary entry that never gets `agent_name: "agent"` is effectively
gone forever** — `mempalace_mempalace_diary_read` requires you to already
know the exact identity to query, and nothing enumerates "every identity
that has ever written an entry." Using any value other than `"agent"`
(a session ID, a project name, anything unique or one-off) orphans that
entry: it will still physically exist in the palace, but no future
session has any way to know it should ask for it.

### 4. Link related projects with tunnels

If a single piece of work genuinely spans multiple projects (not just
"I happened to look at another repo," but a real relationship — shared
API surface, same initiative, one depends on the other), call
`mempalace_mempalace_create_tunnel` to link their wings. An unscoped
`mempalace_mempalace_search` (one without a `wing` filter) searches the
whole palace and can surface cross-project content opportunistically,
but a tunnel makes a known relationship reliable and intentional instead
of something that only shows up if a search happens to get lucky.

## Unhappy paths

- **Empty search results**: say the palace has nothing on this; don't
  invent an answer. Offer to widen the search or file the new
  information.
- **MCP error / server unreachable**: surface the error. Don't silently
  fall back to guessing — tell the user memory isn't available right
  now.
- **Conflicting facts**: trust the knowledge graph's time-valid answer
  (`mempalace_mempalace_kg_query` with `as_of` if timing matters) over an
  older drawer or diary entry that may be stale.

## References

- MemPalace: https://github.com/MemPalace/mempalace
- opencode-memory plugin (this skill's source): local — see the plugin's
  own README/AGENTS.md for how capture is implemented.
