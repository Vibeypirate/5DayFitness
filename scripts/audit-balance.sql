-- Current penalty balances for the group
-- Run this in psql after connecting with: gcloud sql connect fitness-tracker-db --user=fitness_app --database=fitness_tracker

SELECT
    COALESCE(u."username", u."displayName") AS participant,
    COALESCE(SUM(CASE WHEN pl.type IN ('OWED', 'LEAVE_PENALTY') THEN pl.amount ELSE 0 END), 0) AS owed,
    COALESCE(SUM(CASE WHEN pl.type = 'EARNED' THEN pl.amount ELSE 0 END), 0) AS earned,
    COALESCE(SUM(CASE WHEN pl.type = 'MANUAL_ADJUSTMENT' THEN pl.amount ELSE 0 END), 0) AS adjustments,
    COALESCE(SUM(CASE WHEN pl.type = 'EARNED' THEN pl.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN pl.type IN ('OWED', 'LEAVE_PENALTY') THEN pl.amount ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN pl.type = 'MANUAL_ADJUSTMENT' THEN pl.amount ELSE 0 END), 0) AS net_balance
FROM "PenaltyLedger" pl
JOIN "User" u ON pl."userId" = u.id
JOIN "Group" g ON pl."groupId" = g.id
WHERE g."telegramTitle" = 'FiveDayFitness'
GROUP BY u."username", u."displayName"
ORDER BY net_balance ASC;
