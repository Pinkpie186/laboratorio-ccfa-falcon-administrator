UPDATE availability a
SET goal_id=(
  SELECT g.id FROM goals g
  WHERE g.user_id=a.user_id
  ORDER BY (g.status='active') DESC,g.created_at DESC
  LIMIT 1
)
WHERE a.goal_id IS NULL
  AND EXISTS(SELECT 1 FROM goals g WHERE g.user_id=a.user_id);
