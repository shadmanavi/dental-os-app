# Deploy sheet — v18.5 + od-tp-probe

**Date:** 17 August 2026
**Working directory for every command:** `C:\Users\shadm\dental-os-app\dental-os-app`

---

## What is in this zip

| File in zip | Copy to | Note |
|---|---|---|
| `app/chart/page.tsx` | same path | **v18.5.** You already installed this — included so you don't have to hunt for it. Overwrite is safe |
| `supabase/functions/od-tp-probe/index.ts` | same path | **New.** Create the `od-tp-probe` folder |
| `claude/handoff-summary-dental-os.md` | same path | Replaces the existing handoff |
| `claude/working-list-tc-charting.md` | same path | New |

The zip mirrors the repo, so you can unzip over the project root and take the overwrites.

---

## Step 1 — put the files in place

Unzip over `C:\Users\shadm\dental-os-app\dental-os-app`, keeping folder structure. Confirm this file now exists:

```
supabase\functions\od-tp-probe\index.ts
```

## Step 2 — build

```
npm run build
```

Must finish clean. `tsconfig.json` excludes `_sync\`, and the new probe is a Deno file under `supabase\functions\`, which Next does not compile — so this should pass. If it doesn't, stop and send me the error.

## Step 3 — commit and push

```
_session-sync.bat
```

It prompts for a message. Use:

```
v18.5 - autho handled by priority, not a Dental OS control; add od-tp-probe
```

This commits, pushes, and repacks. Vercel builds on the push.

## Step 4 — confirm the frontend actually deployed

Open `https://dental-os-app.vercel.app/` and read the **build badge, top right of the nav**. It shows the 7-character commit Vercel built from. It must match the commit `_session-sync.bat` just pushed.

A matching badge is the only proof. A green Vercel dashboard is not — and a failed build is not an outage, the old deployment simply stays live, which is exactly how v18.5 could appear to deploy and not.

## Step 5 — deploy the Edge Function

**Through the CLI, not through chat.** Mixing chat-side deploys with CLI deploys is what caused the drift this project already fixed once.

```
npx supabase functions deploy od-tp-probe --project-ref mjctkqoggqrgciufqcvd
```

Then confirm it is live:

```
npx supabase functions list --project-ref mjctkqoggqrgciufqcvd
```

`od-tp-probe` should appear. The count goes from 12 to 13.

---

## Step 6 — verify v18.5 in the app

Open a patient at Downey with autho work on the plan. Check all four:

| Check | Expected |
|---|---|
| Per-row Autho dropdown | **Gone** |
| Bulk Pre-Auth / Un-Pre-Auth button | **Gone** |
| Priority dropdown | Shows Auth Needed, Auth Approved, Auth Denied alongside Acc and Diag |
| **Tick an Auth Needed row and sign** | **Signs and prints. The row keeps Auth Needed** |

That last one is the live defect. On v18.4 it silently refuses to sign the whole plan.

---

## Step 7 — run the probe, baseline first

DevTools console on the live app, logged in. Session JWT is in cookie `sb-mjctkqoggqrgciufqcvd-auth-token` (may be base64-encoded with a `"base64-"` prefix).

**Dry run — writes nothing:**

```js
{
  const raw = decodeURIComponent(
    document.cookie.split('; ').find(c => c.startsWith('sb-mjctkqoggqrgciufqcvd-auth-token='))?.split('=').slice(1).join('=') ?? ''
  );
  const txt = raw.startsWith('base64-') ? atob(raw.slice(7)) : raw;
  const jwt = JSON.parse(txt).access_token;

  const r = await fetch('https://mjctkqoggqrgciufqcvd.supabase.co/functions/v1/od-tp-probe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ office: 'downey', pat_num: 17, dry_run: true })
  });
  const j = await r.json();
  console.log(JSON.stringify(j, null, 2));
  copy(JSON.stringify(j, null, 2));
}
```

Paste me the output before running live.

**Live run — only after I have seen the dry run.** Same snippet with `dry_run: false`.

It creates one throwaway `D0230` on patient 17 and possibly one plan headed `DOS PROBE - SAFE TO DELETE`, then removes both in a `finally` block that runs even on an exception. If `/treatplans` turns out not to accept DELETE, the response carries `manual_step_required` and you delete that plan in OpenDental by hand.

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Autho dropdown still on screen after deploying | Stale `.next` cache (local) or badge shows an older commit (live) | Local: stop dev server, `Remove-Item -Recurse -Force .next`, restart, hard-refresh. Live: check the badge against the pushed commit |
| `npm run build` fails on a Deno file | Something outside `supabase\functions\` and `_sync\` is being compiled | Send me the error — do not edit `tsconfig.json` on a guess |
| Probe returns 401 | Cookie was base64 and wasn't decoded, or the session expired | Re-log in, re-run the snippet |
| Probe returns 403 | No role at that office under RLS | Check `offices` and your role row |
| Probe leaves a plan behind | `/treatplans` refused DELETE | Delete `DOS PROBE - SAFE TO DELETE` in OpenDental |

---

## Order matters

Steps 2–4 (frontend) are independent of step 5 (Edge Function) this time — v18.5 needs no new Edge Function field, which is why it can ship alone. That is unusual. **The standing rule still holds for everything else: deploy the Edge Function before any frontend that depends on a new field.**
