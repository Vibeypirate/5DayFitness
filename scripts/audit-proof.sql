-- Proof that only Jaz failed in the May 11 week
-- Run this in psql after connecting with: gcloud sql connect fitness-tracker-db --user=fitness_app --database=fitness_tracker

SELECT
    COALESCE(u."username", u."displayName") AS participant,
    COALESCE(wc.completed_days, 0) AS completed,
    gs."weeklyTarget" AS target,
    CASE WHEN COALESCE(wc.completed_days, 0) >= gs."weeklyTarget" THEN 'PASS ✅' ELSE 'FAIL ❌' END AS result
FROM "GroupParticipant" gp
JOIN "User" u ON gp."userId" = u.id
JOIN "Group" g ON gp."groupId" = g.id
LEFT JOIN "GroupSettings" gs ON g.id = gs."groupId"
LEFT JOIN (
    SELECT "participantId", COUNT(*) AS completed_days
    FROM "WorkoutDayCredit"
    WHERE "weekStartDateLocal" = '2026-05-11'
    GROUP BY "participantId"
) wc ON gp.id = wc."participantId"
WHERE gp.status = 'ACTIVE' AND g."telegramTitle" = 'FiveDayFitness'
ORDER BY completed DESC, participant;
