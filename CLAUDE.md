@AGENTS.md

## Session protocol (required)

Paths below are relative to the project root. Create `docs/` if it
does not exist.

### At the start of every session

1. Read `docs/status.md` if it exists. The newest entry is at the top;
   it is the current state of this project.
2. Look for files matching `FROM-CHAT-*.md` anywhere in the project.
   These carry decisions and specifications from a chat conversation.
   Read every one and treat its contents as working knowledge for this
   session. They are input to you, never something you write.
3. If a FROM-CHAT file conflicts with `docs/status.md`, the FROM-CHAT
   file is newer. Say so and ask before proceeding.

### At the end of every session

Do these in order.

1. Prepend a new entry to `docs/status.md` — newest first, directly
   below any title line. Never overwrite or reorder existing entries.
   The entry must contain:

   - **Date and time** the entry was written
   - **What changed** — files touched and the substance of the change,
     not just filenames
   - **What was verified** — what was run or tested, and the result
   - **What is still open** — unfinished work, known breakage,
     decisions awaiting the owner
   - **Next step** — the single thing the next session should pick up

   Write the entry even if nothing changed. Say so explicitly.

2. Delete every FROM-CHAT file you read at the start of this session,
   but only once its content is reflected in the entry above. If its
   work is unfinished, leave the file in place and note in the entry
   that it is still pending.

3. If `docs/status.md` exceeds 400 lines, move the oldest entries to
   `docs/status-archive.md` (creating it if needed) until the live
   file is back under 400. Keep them in the same newest-first order.

Write the entry before any compaction or context reset, not only at
the end of the conversation.
