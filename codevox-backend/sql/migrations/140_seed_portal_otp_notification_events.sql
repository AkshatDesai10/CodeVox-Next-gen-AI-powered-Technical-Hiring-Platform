-- Portal login + registration OTP email events (production dispatch requires these rows).

INSERT IGNORE INTO erp_notification_events (
  template_key, event_code, category, name, description, recipient_role,
  channel_in_app, channel_email, channel_sms, channel_whatsapp,
  enabled, is_critical, is_external, can_unsubscribe, inactive
) VALUES
(
  'portal_login_otp', '12.1a', 'PORTAL', 'Portal Login OTP',
  'One-time password for institute portal sign-in.',
  'institution_contact', 0, 1, 0, 0, 1, 0, 1, 0, 0
),
(
  'portal_registration_otp', '12.1b', 'PORTAL', 'Registration Email OTP',
  'Email verification code during institute registration.',
  'institution_contact', 0, 1, 0, 0, 1, 0, 1, 0, 0
);
