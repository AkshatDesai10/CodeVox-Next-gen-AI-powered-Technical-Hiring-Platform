-- Portal password reset email event.

INSERT IGNORE INTO erp_notification_events (
  template_key, event_code, category, name, description, recipient_role,
  channel_in_app, channel_email, channel_sms, channel_whatsapp,
  enabled, is_critical, is_external, can_unsubscribe, inactive
) VALUES
(
  'portal_password_reset', '12.1c', 'PORTAL', 'Portal Password Reset',
  'Password reset link for institute portal users.',
  'institution_contact', 0, 1, 0, 0, 1, 0, 1, 0, 0
);
