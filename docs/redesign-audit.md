# Dashboard redesign — Step 1 audit

What exists today, where each piece lives, and where it goes in the redesign.
Line numbers are approximate (index.html, Oct 2026).

## Architecture

| Piece | Where | Notes |
|---|---|---|
| App | `index.html` (~8,000 lines) | One file: CSS in `<style>`, vanilla JS in `<script>`. No framework, no build step. |
| Rendering | `render()` → `sidebarHtml()` + `mainBody()` | Every render rebuilds the DOM from template strings, then `attachHandlers()` rewires events. Scroll, focus, caret and inner-table scroll are captured and restored around each render. |
| Routing | global `view` (`home`, `card`, `calendar`, `orphans`, …) | `mainBody()` switches on it. `NAV_ITEMS` drives the sidebar (pinned items + "More"). |
| Persistence | `netlify/functions/state.js` (Netlify Blobs, key `state`) | Whole `state` object saved as one JSON. Strong reads, `_rev` revision check, 409 → client merges per top-level key (`mergeServerState`). Saves are queued one at a time (`saveState` / `saveOnce`). `loadOk` blocks every write until a load succeeds. |
| Auth | `_auth.js`, `x-dispatch-key` header | Passcode in `localStorage['dispatch-key']`. |
| Calendar | `netlify/functions/outlook.js` | Reads a published Outlook ICS feed (`OUTLOOK_ICS_URL`), expands recurrences, returns events. Client: `loadOutlook()`, `outlookStatus`, `meetingsOn(day)`. Nothing stored. |
| Other functions | `translate.js`, `combine.js` | Used by templates and triage; not part of Home. |
| Browser storage | `localStorage` | Passcode, legacy backup read (`dispatch-state-v2`), reminder last-fired slot (`reminder:<id>`). Everything else is server state. |

## Data model (Home-related parts of `state`)

| Key | Shape | Used for |
|---|---|---|
| `tasks` | `{ id, text, done, createdDate, completedDate, categoryIds[], dueDate, waitingOn }` | Every task. A task can sit in several cards (`categoryIds`); none means General. |
| `categories` | `{ id, label, featuredStat ('remaining'\|'open'), processes[{id,name,steps[]}] }` | Home cards and their order on the Manage cards screen. |
| `dailyCounts` | `{ 'YYYY-MM-DD': { [catId]: { assigned, completed, carried } } }` | Per-card assigned/done numbers. `carryForwardCounts()` rolls unfinished work into today once a day. |
| `waitingOptions` | `string[]` | "Waiting on" dropdown; edited inline. |
| `dailyTasks`, `dailyDone` | `[{id,text,weekdays}]`, `{ day: [ids] }` | Daily checklist (last 14 days kept). |
| `reminders` | `[{id,text,every,from,to,weekdays,on}]` | Scheduled full-screen pop-ups. |
| `teamGoal` | `{ text, notes, target, progress, done, duration, startDate, endDate, repeat }` | Goal card; rolls over when its period ends. |
| `orphans`, `templates`, `members`, `kb`, … | — | Other screens; untouched by the Home redesign. |

## Behaviour inventory → place in the redesign

| Feature | How it works now | Redesign |
|---|---|---|
| Card order | `cardPriority()`: dated open work first (soonest date), then cards with remaining counts, then the rest | Keep the same order. |
| Status colours | `tone-red/amber/blue/green` tint the whole card and add a flag ("Overdue 3 days", "Due in 6 days", "In progress") | Keep the flag and number colour, drop the full tint; a thin coloured edge marks status. |
| Big number | `featuredStat`: remaining (assigned − completed) or open tasks; pin button switches it | Keep, including the pin menu. |
| Counts + progress bar | Two number inputs (commit on every keystroke, debounced save); bar = completed/assigned | Keep as is. |
| Refresh button | `data-rescan-card`: pulls in other tasks mentioning the card's name (with confirm) | Keep. |
| Task rows | Checkbox toggles done (+ toast); text is an editable textarea (save on blur/Enter, Esc reverts); hover shows copy, due/waiting editor, delete; pills for also-in, duplicates, due, waiting | Keep. Open tasks with the same wording in one card are grouped: the soonest shows, the rest fold under "+N more". |
| Add task | Input at the bottom of each card, Enter adds | Keep. |
| Finished tasks | Leave the card front; "N finished · search them" opens the card screen | Keep. |
| Card screen | `viewCardDetail()`: search, steps/processes, full history | Unchanged. |
| General card | Tasks without a card | Keep; folds into the quiet strip when empty. |
| Empty cards | Full-size cards showing 0 | Shown as compact chips in a "Quiet" strip; a chip opens the full card in place. |
| Waiting on | `waitingBadges()` banner, grouped by person, age in days, inline list editor | Keep at the top. |
| Needs attention | `dueTodayPanel()`: overdue + due today | Keep, but leave out tasks already listed under Waiting on. |
| Meetings | `homeMeetingsPanel()`: today's meetings, next one highlighted, refresh | Moves to the top of the side column. |
| Daily tasks | `dailyTasksPanel()` | Keep, below Needs attention. |
| Reminders | `remindersPanel()`, `checkReminders()` every 20 s, full-screen pop-up, optional desktop notification | Compact one-line rows; the form opens from +. Pop-up behaviour unchanged. |
| Team goal | `goalPanel()` | Keep, bottom of the side column. |
| Search | `#task-search` filters cards and tasks across everything | Keep. |
| Sidebar | Pinned items + More, overdue badge on Home | Unchanged. |

## Risks

1. **Full re-render on every change.** New controls must keep the existing patterns: `data-*` attributes wired in `attachHandlers()`, inputs with an `id` or `data-` attribute so focus and caret survive re-renders.
2. **Folding things away can hide work.** Quiet chips only take cards with no open tasks, no remaining count and no dated work; anything with work stays a full card. Grouped duplicates keep the count visible ("+3 more").
3. **The duplicate pill deletes.** "4 copies" offers to remove the others. Recurring tasks with different due dates are not duplicates, so grouping keeps the pill but only inside the expanded list.
4. **Counts are money-adjacent.** No change to `dailyCounts`, carry-forward or Dashboard maths.
5. **Single global stylesheet.** `.card` is shared by every screen; Home changes are scoped to Home classes (`.dcard`, `.home-*`).
6. **Saving.** No new state keys are needed for layout; per-session UI state (which chips or groups are open) stays in memory.
