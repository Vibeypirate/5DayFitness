# Group Membership, Balances, and Photo Challenge Redesign

Date: 2026-04-21

## Goal

Redesign the Telegram fitness bot around a simpler group-first model:

- Telegram group membership becomes challenge membership.
- Weekly summaries and money flow must match real group behavior.
- Member balances must be visible as a running net amount, not only separate owed and earned totals.
- Photo challenges must be simple enough to use quickly in chat.

This spec replaces the old opt-in challenge model and the old reply-based photo review flow.

## Product Rules

### Membership

- Any non-bot user who is in the Telegram group is part of the challenge.
- `/joinchallenge`, `/leavechallenge`, `/pausechallenge`, and `/resumechallenge` are removed from the user workflow.
- The bot keeps participant history in Postgres even after someone leaves the Telegram group.
- A participant who leaves the group is marked as `LEFT_GROUP` or equivalent disqualified status.
- A person who leaves during a week still counts in that current week's summary and penalty calculation.
- Starting with the next local Monday, that person is excluded from new weekly calculations because they are no longer in the group.

### Join Midweek

- New members are automatically added when the bot sees them join the group or first sees them interact after joining.
- Their first-week target is reduced based on the local weekday they joined:
  - Monday: 4
  - Tuesday: 3
  - Wednesday: 2
  - Thursday: 2
  - Friday: 2
  - Saturday: 1
  - Sunday: 1
- On the next Monday, they move to the normal group weekly target.

### Weekly Success

- A participant succeeds for the week when their credited workout days are greater than or equal to their effective target for that week.
- The effective target is the normal group target for continuing members and the reduced target above for the join week only.
- The weekly summary must show who met target and who missed target using the correct effective target for each member.

### Money Rules

- A normal failed week creates a `1000 baht` debt, or the configured group penalty amount, for each failed member.
- A member who leaves the group during the week also gets a leave penalty of `1000 baht`.
- Leave penalties are distributed to that week's successful members the same way as normal penalties.
- The weekly summary must explicitly name leave penalties, for example `@username leave penalty: 1000 baht`.
- The bot must maintain a real running balance per member:
  - positive means the group owes them money overall
  - negative means they owe the group money overall
- Existing ledger events remain the source of truth; running balances are derived from the ledger rather than stored independently if practical.

### Photo Challenge UX

- The user starts a challenge with `/challengephoto @username`.
- The bot replies asking for the reason.
- The challenger sends one follow-up text message with the reason.
- The bot then posts a review message tagging the group and instructing people to vote with reactions.
- The bot should find the most recent workout photo for that target user in the current reviewable window instead of requiring a reply to the exact photo.
- The challenged user cannot vote on their own photo.

### Voting Rules

- Voting uses Telegram reactions on the bot's review message:
  - `👍` means yes, cancel the workout
  - `👎` means no, keep the workout
- The review stays open for 24 hours.
- The bot sends an hourly reminder tagging users who still have not voted.
- At the 24-hour mark:
  - if yes votes are greater than no votes, the workout is invalidated
  - if no votes are greater than yes votes, the workout stays valid
  - if tied, the bot asks the group creator to break the tie with `👍` or `👎`
- The group creator is the only allowed tie-break voter.

### Help and Rules UX

- `/help` becomes the main short command list.
- Long repeated rule walls should be removed from common bot responses.
- Rules text should be shorter and focused on the core behavior:
  - photo flow
  - weekly targets
  - money rules
  - photo challenge voting

## Design Approach

Recommended approach: preserve the current Prisma-backed architecture and evolve the existing services and scheduler rather than replacing them.

Why this is the best fit:

- The repo already has working persistence, weekly rollups, and scheduled jobs.
- The largest gaps are business rules and command UX, not infrastructure shape.
- Reusing the ledger and snapshot model lowers migration risk.

Alternatives considered:

1. Patch only the command UX and keep the old participant model.
   This is not enough because the core product rule has changed from opt-in challenge membership to full group membership.

2. Rebuild the bot flow around a new state machine and new tables.
   This would be clearer in theory but is too risky and too expensive for the current app size.

## Architecture Changes

### Participant Lifecycle

- Add a participant status that distinguishes normal active members from users who left the group.
- Track membership-derived lifecycle timestamps:
  - joined group at
  - left group at
  - disqualified at, if modeled separately
- Add enough metadata to identify whether a participant is still eligible for current and future weekly calculations.

Recommended shape:

- Replace the current challenge-centric status rules with group-membership-centric rules.
- Continue to keep all past participants for historical reports.
- Derive the "current roster" from users still present in the Telegram group, excluding the bot.

### Effective Weekly Target

- Introduce a small domain function that computes a participant's effective weekly target from:
  - group target
  - participant join date
  - week start date
- Use this function consistently in:
  - live leaderboard text
  - `/status` and `/mystats`
  - weekly summary creation
  - penalty distribution

### Balance System

- Keep `PenaltyLedger` as the event log.
- Extend ledger semantics so weekly distribution can include:
  - normal failed-week penalties
  - leave penalties
  - winner earnings
  - manual adjustments
- Add a balance query/service that returns:
  - total owed
  - total earned
  - net balance
- Prefer computing net balance from ledger entries instead of storing a mutable balance column, unless performance becomes an issue.

### Photo Challenge Flow

- Replace the existing reply-to-message review workflow with a two-step conversational flow:
  1. `/challengephoto @username`
  2. bot prompt asks for reason
  3. challenger's next message becomes the reason
  4. bot creates the review and voting message
- Add short-lived pending challenge state so the bot knows which user's reason it is waiting for.
- Resolve the target session by finding the latest reviewable workout photo for that user in the current week.

### Reaction-Based Voting

- The current `WorkoutPhotoReview` model can remain the base record, but it needs new fields for:
  - review deadline
  - reminder schedule state
  - tie-break status
  - target message for reaction tracking
- Votes should be stored explicitly in the database even if they originate from reactions, so summary and reminder logic stays deterministic.
- The app must subscribe to Telegram reaction updates and map them into vote records.

### Owner Detection

- During setup, fetch chat admins/creator metadata and attempt to identify the Telegram group creator.
- Store the creator user id on the group record or settings.
- Tie-break reviews use only that stored creator id.
- If the creator cannot be detected reliably during setup, setup should fail clearly rather than silently choosing the wrong owner.

## Data Model Changes

Expected schema changes:

- `ParticipantStatus`
  - add `LEFT_GROUP` or rename existing statuses to match the new membership model
- `Group` or `GroupSettings`
  - add `ownerUserId`
- `GroupParticipant`
  - add group join date used for prorated first-week target
  - preserve group leave date
- `PenaltyLedger`
  - add a specific type for leave penalties, or encode them with a clear description plus weekly linkage
- `WorkoutPhotoReview`
  - add deadline fields and tie-break state
- New pending challenge table or lightweight conversation-state table
  - group id
  - challenger id
  - target user id
  - expires at
- `WorkoutPhotoReviewVote`
  - may need metadata for reaction type and tie-break origin

## Data Flow

### Member Joins

1. Telegram group join event arrives.
2. Bot upserts the user and participant record.
3. Participant is marked active for the current roster.
4. Join date is stored for effective-target calculation.

### Member Leaves

1. Telegram group leave event arrives.
2. Bot marks the participant as left/disqualified but does not delete history.
3. Bot records a leave-penalty ledger event tied to the current week.
4. Weekly summary for that week still includes the user.
5. Future weeks exclude the user.

### Workout Completion

1. User sends check-in photo.
2. User sends check-out photo after the minimum duration.
3. Bot credits the check-in local date.
4. Stats update:
  - current streak
  - longest streak
  - lifetime completed days
  - weekly progress against effective target

### Photo Challenge

1. Challenger runs `/challengephoto @username`.
2. Bot creates a pending challenge prompt and asks for reason.
3. Challenger replies with reason.
4. Bot finds the target's most recent reviewable workout photo/session.
5. Bot creates a review record and a vote message.
6. Group members except the challenged user react with `👍` or `👎`.
7. Bot stores vote state from reactions.
8. Hourly reminders notify missing voters.
9. At 24 hours, bot resolves majority or asks the creator to tie-break.
10. If passed, the workout session is invalidated and credits/stats are recomputed.

### Weekly Summary

1. Scheduler identifies the week to close.
2. For each participant who belongs in that week's roster, compute:
  - completed days
  - effective target
  - met/missed result
3. Calculate total penalty pool from:
  - failed participants
  - leave penalties incurred that week
4. Distribute pool across successful members.
5. Write snapshot, participant results, and ledger entries.
6. Post summary text with:
  - weekly rankings
  - met target list
  - missed target list
  - leave penalties
  - earnings
  - updated balance-relevant lines

## Error Handling

- If `/challengephoto` omits the target username, reply with a short usage message.
- If the bot is waiting for a reason and the challenger never responds, expire the pending challenge after a short timeout.
- If the bot cannot find a recent workout photo for the target user, fail with a clear message.
- If reaction updates are missing or unsupported in the current Telegram setup, the bot should fail clearly and disable the feature instead of pretending the vote is working.
- If owner detection fails, tie-break flow must not start until setup is corrected.
- Weekly summary creation must stay idempotent per week and group.
- Leave events must not create duplicate leave penalties if Telegram retries the event.

## Testing Strategy

### Unit Tests

- effective target by join weekday
- weekly success calculation with prorated targets
- penalty distribution including leave penalties
- running balance aggregation
- tie behavior and creator-only tie-break eligibility

### Integration Tests

- member joins midweek and gets reduced target
- member leaves midweek and is still counted that week
- member leaves and triggers leave penalty distribution
- `/challengephoto` prompt -> reason -> review creation flow
- reaction votes resolve correctly after 24 hours
- hourly reminder identifies missing voters
- tied vote escalates to creator
- invalidated review recomputes workout credits and totals

### Manual Verification Before Deploy

- verify the live group creator is detected and stored
- verify Telegram reaction updates reach the bot in the chosen bot mode
- verify weekly summaries match the real group roster
- verify a leave event produces the correct weekly result and balance effect
- verify `/help` is short and current

## Rollout Notes

- Do not redeploy before this redesign is implemented and verified together.
- Because the live bot has shown incorrect weekly results, production verification should compare:
  - current week credits in Postgres
  - effective targets
  - final weekly result text
- If the production database already contains weekly snapshots from incorrect logic, leave them untouched and make the corrected logic apply only going forward unless a separate repair script is explicitly requested.

## Open Assumptions Closed In This Spec

- Group membership replaces manual challenge enrollment.
- The challenged user cannot vote.
- Vote duration is 24 hours.
- Missing votes trigger hourly reminders.
- Ties go to the Telegram group creator only.
- Leave penalty amount is 1000 baht and distributes like normal penalties.
- Midweek joiners have a reduced target only for their first week.
