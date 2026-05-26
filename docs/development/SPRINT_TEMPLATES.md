# Sprint Ceremony Templates

> **Project:** Capsule — Cloud Infrastructure Management Platform
> **Methodology:** Hybrid Waterfall-Agile (2-week sprints within phased milestones)
> **Last Updated:** 2026-05-26

---

## Table of Contents

- [Sprint Planning Meeting](#sprint-planning-meeting)
- [Daily Standup (Async)](#daily-standup-async)
- [Sprint Review / Demo](#sprint-review--demo)
- [Sprint Retrospective](#sprint-retrospective)
- [Sprint Report](#sprint-report)

---

## Sprint Planning Meeting

### Meeting Details

| Field            | Value                                  |
|------------------|----------------------------------------|
| **Duration**     | 1.5 hours (max 2 hours)               |
| **Cadence**      | First day of each sprint              |
| **Attendees**    | Product Owner, Scrum Master, Dev Team  |
| **Facilitator**  | Scrum Master                           |
| **Output**       | Sprint Goal + Sprint Backlog           |

### Agenda Template

```
Sprint Planning — Sprint #[XX]
Date: [YYYY-MM-DD]
Phase: [Waterfall Phase — e.g., Phase 2: Core Infrastructure]

═══════════════════════════════════════════════════════════════

1. OPENING (5 min)
   □ Review team capacity and availability
   □ Note planned absences or time-off
   □ Confirm sprint dates: [START] → [END]

2. SPRINT GOAL (10 min)
   □ Product Owner proposes sprint goal
   □ Team discusses and aligns
   □ Sprint Goal: ___________________________________________

3. REVIEW PREVIOUS SPRINT CARRYOVER (10 min)
   □ List incomplete items from Sprint #[XX-1]
   □ Decide: carry forward or return to backlog
   │  ├─ [ISSUE-ID] Description — [Carry/Backlog]
   │  ├─ [ISSUE-ID] Description — [Carry/Backlog]
   │  └─ [ISSUE-ID] Description — [Carry/Backlog]

4. BACKLOG REFINEMENT & SELECTION (30 min)
   □ Product Owner presents prioritized backlog items
   □ For each candidate item:
     ├─ Clarify acceptance criteria
     ├─ Identify component: [backend / frontend / cli / infra]
     ├─ Estimate story points (Fibonacci: 1, 2, 3, 5, 8, 13)
     └─ Identify dependencies and blockers

   Selected Items:
   │ ID          │ Title              │ Points │ Component │ Assignee │
   │─────────────│────────────────────│────────│───────────│──────────│
   │ CAP-XXX     │                    │        │           │          │
   │ CAP-XXX     │                    │        │           │          │
   │ CAP-XXX     │                    │        │           │          │

5. CAPACITY CHECK (10 min)
   □ Total story points selected: ___
   □ Team velocity (last 3 sprints avg): ___
   □ Adjusted capacity (absences, tech debt %): ___
   □ Confirm commitment or adjust scope

6. TASK BREAKDOWN (30 min)
   □ Break selected stories into implementation tasks
   □ Identify technical spikes needed
   □ Flag items needing architecture review
   □ Assign initial owners (can shift during sprint)

7. RISK & DEPENDENCY MAPPING (10 min)
   □ External dependencies (APIs, third-party services)
   □ Cross-component dependencies (backend ↔ frontend)
   □ Infrastructure requirements
   □ Risk mitigations

8. CLOSING (5 min)
   □ Confirm Sprint Goal
   □ Confirm Sprint Backlog
   □ Schedule any needed pairing sessions
   □ Questions and clarifications

═══════════════════════════════════════════════════════════════
Sprint Goal: [Final agreed sprint goal]
Total Points Committed: [XX]
Tech Debt Allocation: [XX]% ([XX] points)
```

---

## Daily Standup (Async)

### Format

Daily standups are **asynchronous** — posted in the team's communication channel (Slack/Discord `#capsule-standup`) by **10:00 AM local time**.

### Message Template

```markdown
## 🧑‍💻 Standup — [Your Name] — [YYYY-MM-DD]

### ✅ What I did yesterday
- [ISSUE-ID] Brief description of progress
  - Completed: [specific deliverable]
  - PR: #[number] (if applicable)
- [ISSUE-ID] Another item
  - Status: [In Review / Merged / In Progress]

### 📋 What I'll do today
- [ISSUE-ID] Planned work
  - Focus: [specific subtask or goal]
  - ETA: [if relevant]
- [ISSUE-ID] Another planned item

### 🚧 Blockers / Risks
- [BLOCKER] Description of the blocker
  - Impact: [which issue(s) affected]
  - Need: [what help is required]
  - From: [who can unblock — @mention]
- None ✅ (if no blockers)

### 💡 Notes
- [Optional: FYI items, architectural questions, shout-outs]
```

### Guidelines

| Rule | Details |
|------|---------|
| **Timebox** | Each update should take < 5 min to write |
| **Be specific** | Reference issue IDs, PR numbers, concrete deliverables |
| **Flag early** | Don't wait — if you're stuck, post a blocker immediately |
| **React** | Use emoji reactions (👀 = read, 🙌 = can help, ⏳ = waiting) |
| **Thread** | Discussions go in threads, not the main standup channel |
| **Sync fallback** | If 2+ blockers are open, Scrum Master schedules a 15-min sync |

---

## Sprint Review / Demo

### Meeting Details

| Field            | Value                                    |
|------------------|------------------------------------------|
| **Duration**     | 1 hour                                   |
| **Cadence**      | Last day of each sprint                  |
| **Attendees**    | Dev Team, Product Owner, Stakeholders    |
| **Facilitator**  | Product Owner                            |
| **Output**       | Feedback log, Backlog adjustments        |

### Demo Script Template

```
Sprint Review — Sprint #[XX]
Date: [YYYY-MM-DD]
Sprint Goal: [Sprint goal statement]

═══════════════════════════════════════════════════════════════

1. WELCOME & CONTEXT (5 min)
   □ Sprint Goal reminder
   □ Phase alignment: [current waterfall phase]
   □ Key metrics snapshot:
     ├─ Points committed: [XX]
     ├─ Points completed: [XX]
     └─ Completion rate: [XX]%

2. DEMO: COMPLETED FEATURES (35 min)

   Demo Item 1: [Feature Title] — [Presenter Name]
   ──────────────────────────────────────────────
   Issue(s): [CAP-XXX, CAP-YYY]
   Component: [backend / frontend / cli]
   
   Demo Flow:
   a) [Step 1 — what to show]
   b) [Step 2 — expected behavior]
   c) [Step 3 — edge case or error handling]
   
   Technical Highlights:
   - [Architecture decision or implementation note]
   - [Performance consideration]
   
   ▸ Questions & Feedback: ________________________

   Demo Item 2: [Feature Title] — [Presenter Name]
   ──────────────────────────────────────────────
   Issue(s): [CAP-XXX]
   Component: [backend / frontend / cli]
   
   Demo Flow:
   a) [Step 1]
   b) [Step 2]
   
   ▸ Questions & Feedback: ________________________

3. INCOMPLETE ITEMS (5 min)
   □ Items not completed and rationale:
   │  ├─ [CAP-XXX] Reason: [dependency / complexity / scope change]
   │  ├─ [CAP-XXX] Reason: [blocker not resolved]
   │  └─ Action: [carry to next sprint / return to backlog / descope]

4. METRICS & TRENDS (5 min)
   □ Velocity trend (last 3-5 sprints chart)
   □ Burndown chart review
   □ Bug count: opened [X] / closed [X]
   □ Tech debt items addressed: [X]

5. STAKEHOLDER FEEDBACK (10 min)
   □ Gather feedback on demonstrated features
   □ Priority adjustments from Product Owner
   □ New items surfaced → add to backlog
   
   Feedback Log:
   │ Item              │ Feedback                    │ Action         │
   │───────────────────│─────────────────────────────│────────────────│
   │                   │                             │                │
   │                   │                             │                │

═══════════════════════════════════════════════════════════════
```

### Demo Best Practices

- **Use real data** — avoid lorem ipsum when possible
- **Show the happy path first**, then edge cases
- **Keep each demo item under 10 minutes**
- **Pre-test everything** — run the demo flow beforehand
- **Record the session** for absent stakeholders
- **CLI demos** — use `asciinema` for terminal recordings

---

## Sprint Retrospective

### Meeting Details

| Field            | Value                                   |
|------------------|-----------------------------------------|
| **Duration**     | 1 hour                                  |
| **Cadence**      | After Sprint Review, same day           |
| **Attendees**    | Dev Team, Scrum Master (no stakeholders)|
| **Facilitator**  | Scrum Master                            |
| **Output**       | Action items with owners and deadlines  |

### Start / Stop / Continue Format

```
Sprint Retrospective — Sprint #[XX]
Date: [YYYY-MM-DD]

═══════════════════════════════════════════════════════════════

SAFETY CHECK (2 min)
──────────────────
Anonymous 1-5 rating: "How safe do you feel speaking openly?"
Average: [X.X] / 5

═══════════════════════════════════════════════════════════════

🟢 START — Things we should begin doing
───────────────────────────────────────
1. [Description]
   └─ Why: [Rationale]
2. [Description]
   └─ Why: [Rationale]
3. [Description]
   └─ Why: [Rationale]

🔴 STOP — Things we should stop doing
──────────────────────────────────────
1. [Description]
   └─ Impact: [What problem is it causing?]
2. [Description]
   └─ Impact: [What problem is it causing?]
3. [Description]
   └─ Impact: [What problem is it causing?]

🔵 CONTINUE — Things that are working well
──────────────────────────────────────────
1. [Description]
   └─ Evidence: [Why do we know it's working?]
2. [Description]
   └─ Evidence: [Why do we know it's working?]
3. [Description]
   └─ Evidence: [Why do we know it's working?]

═══════════════════════════════════════════════════════════════

VOTING & PRIORITIZATION
────────────────────────
Each team member gets 3 votes. Top items become action items.

│ Rank │ Item                          │ Votes │
│──────│───────────────────────────────│───────│
│ 1    │                               │       │
│ 2    │                               │       │
│ 3    │                               │       │

═══════════════════════════════════════════════════════════════

ACTION ITEMS
─────────────
│ # │ Action                 │ Owner    │ Deadline       │ Status    │
│───│────────────────────────│──────────│────────────────│───────────│
│ 1 │                        │ @name    │ Sprint #[XX+1] │ ⬜ Open   │
│ 2 │                        │ @name    │ Sprint #[XX+1] │ ⬜ Open   │
│ 3 │                        │ @name    │ Sprint #[XX+1] │ ⬜ Open   │

FOLLOW-UP FROM LAST RETRO
──────────────────────────
│ # │ Action                 │ Owner    │ Status                    │
│───│────────────────────────│──────────│───────────────────────────│
│ 1 │                        │ @name    │ ✅ Done / ⬜ Open / ❌ NA │
│ 2 │                        │ @name    │ ✅ Done / ⬜ Open / ❌ NA │

═══════════════════════════════════════════════════════════════

TEAM MORALE (anonymous)
───────────────────────
"How do you feel about the sprint?"  😀 😊 😐 😕 😞
Results: 😀 [X]  😊 [X]  😐 [X]  😕 [X]  😞 [X]
```

### Facilitation Tips

- **Rotate facilitator** every 2-3 sprints to keep it fresh
- **Use a timer** — 10 min per section max
- **Silent brainstorming first** (5 min), then share
- **No blame** — focus on processes, not people
- **Limit action items to 3** — better to complete few than track many
- **Alternate formats occasionally:** Mad/Sad/Glad, 4Ls, Sailboat

---

## Sprint Report

### Template

```markdown
# Sprint Report — Sprint #[XX]

**Sprint Dates:** [START] → [END]
**Phase:** [Waterfall Phase Name]
**Sprint Goal:** [Goal statement]
**Goal Achieved:** ✅ Yes / ⚠️ Partial / ❌ No

---

## Summary

[2-3 sentence executive summary of the sprint's outcomes]

---

## Metrics

| Metric                    | Value   | Target  | Trend |
|---------------------------|---------|---------|-------|
| Story Points Committed    | [XX]    | —       | —     |
| Story Points Completed    | [XX]    | —       | —     |
| Completion Rate           | [XX]%   | ≥ 85%   | ↑↓→   |
| Velocity (3-sprint avg)   | [XX]    | —       | ↑↓→   |
| Bugs Opened               | [X]     | —       | ↑↓→   |
| Bugs Closed               | [X]     | —       | ↑↓→   |
| Tech Debt Items Resolved  | [X]     | ≥ 2     | ↑↓→   |
| PRs Merged                | [X]     | —       | —     |
| Avg PR Review Time        | [X]h    | < 24h   | ↑↓→   |
| Test Coverage (backend)   | [XX]%   | ≥ 80%   | ↑↓→   |
| Test Coverage (frontend)  | [XX]%   | ≥ 80%   | ↑↓→   |

---

## Completed Items

| ID       | Title                        | Component | Points | Assignee |
|----------|------------------------------|-----------|--------|----------|
| CAP-XXX  | [Description]                | backend   | [X]    | @name    |
| CAP-XXX  | [Description]                | frontend  | [X]    | @name    |
| CAP-XXX  | [Description]                | cli       | [X]    | @name    |

---

## Incomplete Items

| ID       | Title                        | Status       | Reason           | Action       |
|----------|------------------------------|--------------|------------------|--------------|
| CAP-XXX  | [Description]                | In Progress  | [reason]         | Carry → S#XX |
| CAP-XXX  | [Description]                | Blocked      | [blocker detail] | Backlog      |

---

## Key Decisions Made

1. [Decision description] — See ADR-[XXX]
2. [Decision description]

---

## Risks & Issues

| Risk / Issue                 | Severity | Mitigation              | Owner  |
|------------------------------|----------|-------------------------|--------|
| [Description]                | High     | [Plan]                  | @name  |
| [Description]                | Medium   | [Plan]                  | @name  |

---

## Retrospective Action Items

1. [Action] — Owner: @name — Due: Sprint #[XX+1]
2. [Action] — Owner: @name — Due: Sprint #[XX+1]

---

## Next Sprint Preview

**Sprint Goal (tentative):** [Next sprint goal]
**Key items planned:**
- [CAP-XXX] [Description]
- [CAP-XXX] [Description]
- [CAP-XXX] [Description]

---

_Report prepared by: [Scrum Master Name]_
_Date: [YYYY-MM-DD]_
```

---

## Appendix: Sprint Calendar Template

```
Sprint #[XX] Calendar
═══════════════════════════════════════════════════════

Week 1
├─ Mon: Sprint Planning (1.5h) + Dev work
├─ Tue: Dev work
├─ Wed: Dev work + Mid-sprint check-in (15 min)
├─ Thu: Dev work
└─ Fri: Dev work

Week 2
├─ Mon: Dev work
├─ Tue: Dev work
├─ Wed: Dev work + Backlog Refinement (1h)
├─ Thu: Dev work + Code freeze (EOD)
└─ Fri: Sprint Review (1h) + Retrospective (1h)

Daily: Async standup by 10:00 AM
```
