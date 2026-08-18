# Working List — Dental OS / TC Charting

**Owner:** Shad
**Last updated:** 17 August 2026
**Purpose:** One list. Every open item with the findings that bear on it, so a single item can be picked up and worked without re-reading the session.

**Ordering:** Section A is workable today. Section B needs an answer from Shad. Section C needs a write probe deployed first. Nothing in B or C should be started before its blocker clears.

---

## A. Ready to work now

### A1 — Deploy v18.5
**State:** Built, verified, running locally. Not pushed.

`app/chart/page.tsx` v18.5 removes the autho dropdown and stops `signAndFile` aborting on autho rows. Type-checked clean against the real `tsconfig.json`; 32-check structural verifier green.

**Why it matters:** Vercel still runs v18.4. Un-hiding the three autho priorities made a latent guard reachable, so **on production right now, one ticked procedure at Auth Needed blocks the signature for the whole plan** — not just that row.

**Next:** `npm run build`, then `_session-sync.bat`.

---

### A2 — Build out 8 Diag + 8 Acc priorities
**State:** Not started. No code required.

Both offices currently have Diag 1–4 and Acc 1–4. Target is 8 + 8, plus the three autho values already unhidden — 19 visible.

**Facts:**
- The app reads whatever is not hidden (`WHERE Category = 20 AND IsHidden = 0`), so new values appear with no deploy.
- Pairing is by **name** — `Acc 5` accepts `Diag 5`. Spelling must match exactly or the flip silently won't find its target.
- DefNums will differ between offices. That is fine and expected; nothing keys on them.
- Downey has hidden legacy priorities literally named `5`, `6`, `7`, `8` holding 2,559 / 1,444 / 992 / 5 treatment-planned procedures. Naming new ones `Diag 5` avoids collision, but those old rows still exist.

**Do this before A3.**

---

### A3 — Trial all 19 priorities in TC Charting
**State:** Blocked only by A2.

The point is to find out whether 19 options in one dropdown is workable before building a filter table for it. If it is, T4 (the priority-visibility table) may never be needed.

---

### A4 — DIAGS title row reflow
**State:** Diagnosed, not fixed.

Nothing "moves the title bar" — it is one `flex flex-wrap` row where five of eight children have runtime-variable width, so the row re-wraps when the total crosses the container.

| Element | What varies |
|---|---|
| Create TP button | `Create TP` → `Create TP (1)` → `(12)` — widens again at two digits |
| Count text | **Three** states: `reading…` · `8 open · tick what to present` · `1 of 8 ticked` |
| Dx select | Width follows its widest option — the office's diagnosis list, loaded at runtime |
| Priority select | Same, and it **just got wider** — "Auth Approved" is longer than "Optional Acc" |
| Master checkbox, DIAGS, Refresh, Delete… | Fixed |

**Two things not previously flagged:**
- `reading…` is the third state of that span, so the row also shifts during load and after every Refresh.
- The two selects differ between Downey and Maywood, so the row can wrap differently at the two offices with identical patient data.

**Interaction:** A2 makes this worse before it gets better. 19 options with longer labels widen the Priority select further.

---

### A5 — Title row redesign
**State:** Not started.

The row is busy; the controls may want reorganising or a different design.

**Do this in the same pass as A4** — stabilising the widths of a layout that is about to be replaced is wasted work.

---

### A6 — Clear the 4 stale `(DOS Entry)` note tokens
**State:** Ready. Data fix, not a code fix.

Four procedures at Downey carry the preauth token in their procedure note. All test data. v18.5 no longer writes or reads it.

---

### A7 — Strip `set_note` and `preauth` from `od-plan`
**State:** Ready, low priority.

v18.5 stopped calling them. The action and the returned field are now dead code. `od-plan` stays at v8 until this is done — deliberately, so v18.5 needed no Edge Function deploy.

**Reminder:** download and diff the deployed function before editing. The repo copy has been two versions behind the live one before.

---

## B. Blocked on a decision from Shad

### B1 — TPi-as-parking vs TPi-as-acceptance
**Needed:** Confirmation these are different things.

"TPi as the acceptance mechanism" is on the permanently-rejected list. What is now proposed is TPi as the **declined / parked** mechanism, which is what the status is actually for. Confirm before C1 is designed.

---

### B2 — What happens to a TPi procedure in TC Charting
**Needed:** Show it dimmed, or hide it?

`od-plan` reads `ProcStatus = 1` only. The moment a procedure goes TPi it vanishes from TC Charting completely.

**Conflict:** the standing rule is *"declined work stays at Diag so it re-presents at the next visit."* If declining now means TPi, and TPi is invisible, declined work never re-presents. This has to be answered as part of C1, not after it.

---

### B3 — Accepting an autho procedure, especially a denied one
**Needed:** A rule.

**Current behaviour after v18.5:** an autho row is filed and printed with everything else, and its priority is left exactly where the biller put it. That was chosen deliberately — what a carrier decided is not the app's to overwrite, and no `Auth Approved Acc` exists to move it to.

**Open:** what *should* happen when a patient accepts work sitting at Auth Denied? Options previously raised:

| Option | Cost |
|---|---|
| Move to Acc 1 (or a chosen level) | Normal behaviour; autho history lost from the field |
| Leave it, exclude from ticking with a reason shown | Nothing silent; coordinator must resolve the autho first |
| Add `Auth Approved Acc` etc. to both offices | Pairing works automatically via `ACC_SUFFIX_RE`, **no code change at all** |

---

### B4 — Maywood shows "Not Accepted", Downey hides it
**Needed:** Deliberate, or leftover?

Maywood's visible priority list includes `Not Accepted` (DefNum 150). Downey's is hidden and holds 20,462 treatment-planned procedures.

---

### B5 — Clinician / hygienist role
**Needed:** Is there one, or are they front desk with a different tile set? Should they see insurance figures and pricing, or clinical only?

**Unblocks:** user management.

---

### B6 — Carrier bucketing query
**Needed:** The query text, the bucket list, and whether it is still live at all.

---

### B7 — `od-benefit-probe`
**Needed:** Delete it, or keep it? It is marked temporary and its office question is now answered.

---

### B8 — Migration filenames
**Needed:** Do the mixed-format names need tidying?

---

## C. Blocked on a write probe

`od_probe` is **read-only by design** — GET, or PUT to `/queries/ShortQuery`. It refuses everything else. So none of the questions below can be answered from chat. They need `od-chart-probe` v10: a write probe that creates a throwaway procedure, tests each call, and reverses itself whatever the outcome.

**This needs approval before it is built.**

### C0 — The probe itself
| # | Question | Blocks |
|---|---|---|
| H1 | Does `PUT /procedurelogs/{n}` accept `ProcStatus` TPi? | C1 |
| H2 | Does `/treatplanattaches` accept POST and DELETE? | C1 and C2 |
| H3 | Can an Active plan be created or promoted via API? | C2 |
| H4 | If H3 is no — does OpenDental auto-create the Active plan, so the app only ever attaches to an existing one? | C2 |

**Precedent for pessimism:** `POST /procedurelogs` refused `ProcStatus EC` outright — EO was the compromise. `POST /treatplans` accepted `Saved` with a 201 and filed the plan as Inactive anyway, and `PUT` would not move it afterwards. That finding is old enough to be worth re-testing rather than trusted, but it is the reason H3 is on this list.

---

### C1 — Remove Delete; replace with "make inactive"
**Blocked by:** H1, H2, B1, B2.

Deleting a procedure from the app is not a good idea. Instead, checked procedures move to inactive — which in OpenDental means **two writes**, not one: `ProcStatus` → TPi, and an attach row onto the patient's Inactive plan.

---

### C2 — Accepted procedure goes onto the Active plan
**Blocked by:** H2, H3, H4.

On acceptance a procedure should (a) move to its Acc priority — already built — and (b) be attached to the patient's Active treatment plan. If an Active plan already exists, ask whether to inactivate it, because OpenDental allows only one.

---

### C3 — Biller worklist: "answered by carrier, never recorded"
**Blocked by:** B3, and lower priority than C1/C2.

8,012 of 9,573 flagged procedures at Downey sit on preauth claims still at status `S` — sent, never marked received. The billers update the priority field and never touch the claim. A worklist would surface exactly that gap.

---

## D. Reference — findings from this session

### D1 — Preauthorization in OpenDental

There is **no** approved/denied field anywhere — not on the claim, claimproc, procedure, plan or carrier. The answer is derivable in two steps:

| Signal | Field | Meaning |
|---|---|---|
| Did an answer come back? | `claim.ClaimStatus = 'R'` | Yes/no only |
| What was the answer? | `claimproc.InsEstTotalOverride` | Positive = approved at that amount · Zero = nothing allowed · −1 = never entered |

**`InsPayEst` is not the answer field.** OpenDental pre-fills it at claim creation — 10,546 of 15,195 *unanswered* rows already carry a positive figure.

**Accuracy is good; coverage is poor.** Against the office's own human labels: Auth Approved 96.8% agreement, Auth Denied 98.0%. But the claim status is stale on 84% of rows, which is why the priority field is the real record and the claim chain is only a cross-check.

The preauth line links to the exact procedure: `procedurelog` → `claimproc` (`Status = 2`, `ClaimNum > 0`) → `claim` (`ClaimType = 'PreAuth'`). 100% of preauth claimproc rows carry a real `ProcNum`.

---

### D2 — Autho priorities

Hidden, never deleted. Un-hidden at both offices on 17 August.

| Office | Auth Needed | Auth Approved | Auth Denied |
|---|---|---|---|
| Downey | 613 | 256 | 159 |
| Maywood | 149 | 159 | 556 |

**Downey's 159 is Auth Denied. Maywood's 159 is Auth Approved.** Same number, opposite answers. Everything must key on the name — `/^auth\b/i` in v18.5 — never the DefNum.

At Downey these three still carry 11,632 treatment-planned procedures: 5,263 Auth Needed, 3,553 Auth Approved, 2,816 Auth Denied.

---

### D3 — Treatment plan structure

**The enum on record was wrong.** Verified against `Heading` on patient 17:

| `TPStatus` | Means | Membership held in |
|---|---|---|
| 0 | **Saved** — 6,320 legacy frozen plans | `proctp` |
| 1 | **Active** | `treatplanattach` |
| 2 | **Inactive** | `treatplanattach` |

**One Active plan per patient:** 14,581 of 14,585. Four old exceptions.

**Membership cross-tab at Downey:**

| Procedure status | Plan status | Rows |
|---|---|---|
| TP (1) | Active | 111,427 |
| TP (1) | Inactive | 5,464 |
| TPi (8) | Inactive | 21,457 |
| TPi (8) | **Active** | **0** |

**TPi is in long-standing production use** — 20,073 procedures at Downey, **all** of them attached to a plan, **none** on an Active plan. The invariant is absolute.

A procedure can be attached to two plans at once — 1082014 sits on both the Active and an Inactive plan.

`/treatplanattaches` is a valid API resource and GET works. `/treatplanattachs` 404s.

---

### D4 — Settled and not to be re-litigated

- Migration `statements` NULLs: **already repaired.** All 18 rows hold real SQL; `migration fetch` cannot blank the 014/015 files. The v1 function body for `20260817180100` is unrecoverable and a documented placeholder sits in its place — history only, the deployed function is fine.
- `od-plan` stays at v8. Its `set_note` action and `preauth` field are dead but harmless, so v18.5 shipped without an Edge Function deploy and without deploy-order risk.

---

## E. Carried over

| # | Item | Note |
|---|---|---|
| E1 | Priority-visibility table in TC Charting | Only if A3 shows 19 options is unworkable |
| E2 | Instructional video | Playwright demo, then narration script |
| E3 | Tablet fleet rollout | 5 units — 3 Downey, 2 Maywood — plus a floater. Two test units installed |

---

## F. Live risks

| Risk | Status |
|---|---|
| **Production blocks signing on any autho row** | Real now. v18.5 fixes it and is not deployed — see A1 |
| A2 widens the Priority select before A4 fixes the reflow | Accepted; A4 and A5 should follow A2 closely |
| Editing an Edge Function from the repo copy rather than the deployed one | Standing rule: download and diff first, every time, whatever the version header says |

---

## G. Suggested order

1. **A1** — deploy v18.5. It fixes a live defect and nothing depends on it.
2. **B1 + B2** — cheap to answer, and they shape what the probe in C0 should test.
3. **C0** — build and run the write probe. C1 and C2 are the largest items on the list and neither can be designed until H1–H4 are answered.
4. **A2 → A3** — priority build-out and the 19-option trial. No code, and it feeds E1.
5. **A4 + A5** — title row, one pass.
6. Everything else.
