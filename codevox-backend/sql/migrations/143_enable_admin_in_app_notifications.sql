-- Enable in-app delivery for admin-facing portal events.
UPDATE erp_notification_events
SET channel_in_app = 1,
    recipient_role = 'finance_team'
WHERE template_key IN ('new_registration', 'registration_submitted')
  AND inactive = 0;

UPDATE erp_notification_events
SET channel_in_app = 1,
    recipient_role = 'finance_team'
WHERE template_key = 'proposal_submitted'
  AND inactive = 0;

UPDATE erp_notification_events
SET channel_in_app = 1,
    recipient_role = 'cfo'
WHERE template_key = 'contract_amendment'
  AND inactive = 0;
