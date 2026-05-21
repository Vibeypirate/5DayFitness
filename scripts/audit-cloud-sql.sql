-- Run this directly against your Cloud SQL database to audit missed workouts.
-- Connect with: gcloud sql connect fitness-tracker-db --user=fitness_app --database=fitness_tracker

WITH weekly_credits AS (
    SELECT
        wdc."participantId",
        wdc."weekStartDateLocal",
        COUNT(*) AS completed_days
    FROM "WorkoutDayCredit" wdc
    GROUP BY wdc."participantId", wdc."weekStartDateLocal"
),
participant_target AS (
    SELECT
        gp.id AS participant_id,
        gp."groupId",
        gp."joinedAt",
        gp."joinedWeekStartDateLocal",
        u."displayName",
        u."username",
        g."telegramTitle",
        gs."weeklyTarget" AS base_target,
        CASE
            WHEN gp."joinedWeekStartDateLocal" IS NULL THEN gs."weeklyTarget"
            WHEN gp."joinedWeekStartDateLocal" != (SELECT MIN(wc."weekStartDateLocal") FROM weekly_credits wc WHERE wc."participantId" = gp.id) THEN gs."weeklyTarget"
            ELSE LEAST(gs."weeklyTarget", COALESCE(
                (CASE EXTRACT(DOW FROM gp."joinedAt" AT TIME ZONE 'UTC')::int
                    WHEN 1 THEN 4
                    WHEN 2 THEN 3
                    WHEN 3 THEN 2
                    WHEN 4 THEN 2
                    WHEN 5 THEN 2
                    WHEN 6 THEN 1
                    WHEN 0 THEN 1
                END),
                gs."weeklyTarget"
            ))
        END AS effective_target
    FROM "GroupParticipant" gp
    JOIN "User" u ON gp."userId" = u.id
    JOIN "Group" g ON gp."groupId" = g.id
    LEFT JOIN "GroupSettings" gs ON g.id = gs."groupId"
    WHERE gp.status = 'ACTIVE'
)
SELECT
    pt."telegramTitle" AS group_name,
    COALESCE(pt."username", pt."displayName") AS participant,
    COALESCE(wc."weekStartDateLocal", pt."joinedWeekStartDateLocal") AS week_start,
    COALESCE(wc.completed_days, 0) AS completed,
    pt.effective_target AS target,
    GREATEST(0, pt.effective_target - COALESCE(wc.completed_days, 0)) AS missed
FROM participant_target pt
LEFT JOIN weekly_credits wc ON pt.participant_id = wc."participantId"
WHERE COALESCE(wc.completed_days, 0) < pt.effective_target
ORDER BY pt."telegramTitle", wc."weekStartDateLocal", participant;
