-- Portal onboarding + proposal notification events (catalog additions after initial seed).

INSERT IGNORE INTO erp_notification_events (
  template_key, event_code, category, name, description, recipient_role,
  channel_in_app, channel_email, channel_sms, channel_whatsapp,
  enabled, is_critical, is_external, can_unsubscribe, inactive
) VALUES
(
  'new_registration', '12.7', 'PORTAL', 'New Registration',
  'Notifies when a new institute registration is submitted.',
  'institution_contact', 0, 1, 0, 0, 1, 0, 0, 0, 0
),
(
  'registration_submitted', '12.7a', 'PORTAL', 'Registration Submitted',
  'Confirms registration was received for review.',
  'institution_contact', 0, 1, 0, 0, 1, 0, 0, 0, 0
),
(
  'registration_approved', '12.7b', 'PORTAL', 'Registration Approved',
  'Institution registration approved; portal access enabled.',
  'institution_contact', 0, 1, 0, 0, 1, 0, 0, 0, 0
),
(
  'registration_rejected', '12.7c', 'PORTAL', 'Registration Rejected',
  'Institution registration was rejected.',
  'institution_contact', 0, 1, 0, 0, 1, 1, 0, 0, 0
),
(
  'proposal_submitted', '12.8', 'PORTAL', 'New Proposal Submitted',
  'Notifies when an institute self-service proposal is submitted.',
  'institution_contact', 1, 1, 0, 0, 1, 0, 0, 0, 0
),
(
  'proposal_quoted', '12.9', 'PORTAL', 'Proposal Converted to Quote',
  'Notifies when a proposal is converted into a quote.',
  'institution_contact', 1, 1, 0, 0, 1, 0, 0, 0, 0
);
