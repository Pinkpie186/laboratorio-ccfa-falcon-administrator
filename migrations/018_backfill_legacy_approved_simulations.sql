UPDATE simulations
SET approval_status='approved',
    decided_at=COALESCE(submitted_at,finished_at)
WHERE status='finished' AND approval_status='not_required';
