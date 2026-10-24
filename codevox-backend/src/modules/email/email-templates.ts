export function buildMagicLinkEmail(
  candidateName: string,
  jobTitle: string,
  magicLinkUrl: string,
  scheduledSlotLabel?: string | null,
): { subject: string; html: string } {
  const firstName = candidateName.split(' ')[0] || 'Candidate';
  const slotBlock = scheduledSlotLabel
    ? `<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
          Your scheduled assessment slot: <strong style="color:#1e293b;">${scheduledSlotLabel}</strong>
        </p>`
    : '';
  return {
    subject: `You're invited to complete your assessment for ${jobTitle}`,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f6f8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <tr>
      <td style="background:linear-gradient(135deg,#1a237e 0%,#3949ab 100%);padding:32px 40px;">
        <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Assessment Invitation</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 40px;">
        <p style="margin:0 0 16px;color:#1e293b;font-size:16px;line-height:1.6;">
          Hi ${firstName},
        </p>
        <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
          You've been invited to complete an assessment for the <strong style="color:#1e293b;">${jobTitle}</strong> position. This assessment will help us understand your skills and experience.
        </p>
        ${slotBlock}
        <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
          Please ensure you are on a laptop/desktop with a working webcam and microphone in a quiet room before clicking below to begin.
        </p>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
          <tr>
            <td style="background:#1a237e;border-radius:8px;">
              <a href="${magicLinkUrl}" target="_blank" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
                Start Your Assessment →
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.5;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="margin:0 0 24px;word-break:break-all;">
          <a href="${magicLinkUrl}" style="color:#3949ab;font-size:13px;">${magicLinkUrl}</a>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
          This link is unique to you — please do not share it. For the best experience, please use Google Chrome on a laptop or desktop. If you have any questions, reply to this email.
        </p>
      </td>
    </tr>
    <tr>
      <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:11px;">
          © ${new Date().getFullYear()} iCloudEMS. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

export function buildNoOpeningEmail(
  candidateName: string,
  courseName: string,
): { subject: string; html: string } {
  const firstName = candidateName.split(' ')[0] || 'Candidate';
  return {
    subject: `Update regarding your application for ${courseName} — iCloudEMS`,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f6f8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <tr>
      <td style="background:linear-gradient(135deg,#1a237e 0%,#3949ab 100%);padding:32px 40px;">
        <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Application Status</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 40px;">
        <p style="margin:0 0 16px;color:#1e293b;font-size:16px;line-height:1.6;">
          Hi ${firstName},
        </p>
        <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
          Thank you for your interest in joining <strong style="color:#1e293b;">iCloudEMS</strong> and taking the time to apply for the <strong style="color:#1e293b;">${courseName}</strong> position.
        </p>
        <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
          At this moment, we are not actively hiring for this specific role as the current positions have been filled. However, we were impressed by your profile and have added your resume to our active talent pool.
        </p>
        <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
          If a suitable opening matching your skills and experience becomes available in the future, our recruitment team will reach out to you directly.
        </p>
        <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
          We truly appreciate your time and wish you the very best in your career pursuits.
        </p>
        <p style="margin:0;color:#1e293b;font-size:15px;line-height:1.6;">
          Warm regards,<br/>
          <strong style="color:#1e293b;">Talent Acquisition Team</strong><br/>
          <span style="color:#64748b;font-size:14px;">iCloudEMS</span>
        </p>
      </td>
    </tr>
    <tr>
      <td style="background:#f8fafc;padding:20px 40px;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:11px;">
          © ${new Date().getFullYear()} iCloudEMS. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}
