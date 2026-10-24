-- Clear stuck manual pins so auto-rebalance can move cameras to online workers.
UPDATE ca_cameras
SET assignment_pinned = 0
WHERE inactive = 0 AND assignment_pinned = 1;
