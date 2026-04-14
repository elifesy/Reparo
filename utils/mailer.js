'use strict';
const nodemailer = require('nodemailer');
const db         = require('../db/setup');

// ── Read all smtp_* and email_notify_* settings from DB ───────────────────────
function cfg() {
  const rows = db.prepare(`SELECT key,value FROM settings WHERE key LIKE 'smtp_%' OR key LIKE 'email_notify%'`).all();
  const o = {};
  rows.forEach(r => { o[r.key] = r.value; });
  return o;
}

// ── Build a transporter from saved SMTP settings ──────────────────────────────
function makeTransport(c) {
  const port   = parseInt(c.smtp_port || '587', 10);
  const secure = c.smtp_secure === '1';   // true = SSL/TLS (port 465)
  return nodemailer.createTransport({
    host:   c.smtp_host,
    port,
    secure,
    auth:   { user: c.smtp_user, pass: c.smtp_pass },
    tls:    { rejectUnauthorized: false },   // allow self-signed certs on shared hosting
  });
}

// ── Status-specific copy ───────────────────────────────────────────────────────
const STATUS_COPY = {
  'Received':       { emoji: '📥', line: 'Your device has been received and is awaiting a technician.' },
  'Diagnosed':      { emoji: '🔍', line: 'We have diagnosed your device and will be in touch shortly.' },
  'In Progress':    { emoji: '🔧', line: 'Repair work is actively underway on your device.' },
  'Awaiting Parts': { emoji: '📦', line: 'We are waiting for parts to arrive before continuing your repair.' },
  'Ready':          { emoji: '✅', line: 'Great news — your device is repaired and ready for collection!' },
  'Dispatched':     { emoji: '🚚', line: 'Your device has been dispatched. Expect delivery soon.' },
};

// ── HTML-escape user-supplied strings before interpolating into the template ──
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Escape a value safe for use in an HTML attribute URL (href/mailto/tel)
function escAttr(v) {
  const s = String(v ?? '');
  // Reject any javascript:/data: schemes outright
  if (/^\s*(javascript|data|vbscript):/i.test(s)) return '';
  return esc(s);
}

// ── HTML email template ───────────────────────────────────────────────────────
function buildHtml(raw) {
  const portalName   = esc(raw.portalName);
  const custName     = esc(raw.custName);
  const serviceId    = esc(raw.serviceId);
  const device       = esc(raw.device);
  const status       = esc(raw.status);
  const emoji        = esc(raw.emoji);
  const line         = esc(raw.line);
  const phone        = raw.phone ? escAttr(raw.phone) : '';
  const supportEmail = escAttr(raw.supportEmail);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Service Update</title></head>
<body style="margin:0;padding:0;background:#f0f2f8;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f8;padding:36px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.09)">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1e1b4b 0%,#3730a3 100%);padding:26px 36px">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-.3px">${portalName}</h1>
    <p style="margin:5px 0 0;color:rgba(255,255,255,.65);font-size:12px;letter-spacing:.04em;text-transform:uppercase">Device Service Management</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:28px 36px 0">
    <p style="margin:0 0 6px;color:#6b7280;font-size:14px">Hello ${custName},</p>
    <p style="margin:0 0 22px;color:#111827;font-size:15px;line-height:1.5">There is an update on your repair request. Here is the current status:</p>
  </td></tr>

  <!-- Status card -->
  <tr><td style="padding:0 36px">
    <div style="background:#eef2ff;border-left:5px solid #4338ca;border-radius:8px;padding:18px 22px">
      <span style="font-size:28px">${emoji}</span>
      <p style="margin:8px 0 4px;font-size:21px;font-weight:800;color:#1e1b4b">${status}</p>
      <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.55">${line}</p>
    </div>
  </td></tr>

  <!-- Service info -->
  <tr><td style="padding:22px 36px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <tr style="background:#f9fafb">
        <td style="padding:9px 14px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e5e7eb">Service ID</td>
        <td style="padding:9px 14px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e5e7eb">Device</td>
      </tr>
      <tr>
        <td style="padding:13px 14px;font-family:monospace;font-size:16px;font-weight:700;color:#1e1b4b">${serviceId}</td>
        <td style="padding:13px 14px;font-size:14px;color:#374151">${device || '—'}</td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 36px 30px;text-align:center">
    <p style="margin:0 0 16px;color:#6b7280;font-size:13px">Questions? Our team is ready to help.</p>
    ${phone ? `<a href="tel:${phone}" style="display:inline-block;background:#4338ca;color:#fff;text-decoration:none;border-radius:8px;padding:13px 30px;font-size:14px;font-weight:600;margin:0 6px">📞 ${phone}</a>` : ''}
    <a href="mailto:${supportEmail}" style="display:inline-block;background:#f3f4f6;color:#374151;text-decoration:none;border-radius:8px;padding:13px 30px;font-size:14px;font-weight:600;margin:0 6px">✉️ Email Us</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 36px;text-align:center">
    <p style="margin:0;color:#9ca3af;font-size:12px">${portalName} · <a href="mailto:${supportEmail}" style="color:#4338ca;text-decoration:none">${supportEmail}</a></p>
    <p style="margin:5px 0 0;color:#d1d5db;font-size:11px">This is an automated message — please do not reply to this email.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Public: send status notification ─────────────────────────────────────────
async function sendStatusNotification(service, newStatus) {
  const c = cfg();

  // Global toggle
  if (c.email_notify_enabled !== '1') return;

  // Must be in the configured statuses list
  let notifyList = [];
  try { notifyList = JSON.parse(c.email_notify_statuses || '[]'); } catch {}
  if (!notifyList.includes(newStatus)) return;

  // Need a recipient
  if (!service.cust_email) return;

  // Need SMTP configured
  if (!c.smtp_host || !c.smtp_user) return;

  const settings = {
    portalName:   db.prepare(`SELECT value FROM settings WHERE key='portal_name'`).get()?.value || 'Reparo',
    phone:        db.prepare(`SELECT value FROM settings WHERE key='support_phone'`).get()?.value || '',
    supportEmail: db.prepare(`SELECT value FROM settings WHERE key='support_email'`).get()?.value || c.smtp_user,
  };

  const copy = STATUS_COPY[newStatus] || { emoji: '🔔', line: `Status updated to: ${newStatus}` };
  const html = buildHtml({
    portalName:   settings.portalName,
    custName:     service.cust_name || 'Customer',
    serviceId:    service.id,
    device:       `${service.brand || ''} ${service.model || ''}`.trim() || service.device_type || '',
    status:       newStatus,
    emoji:        copy.emoji,
    line:         copy.line,
    phone:        settings.phone,
    supportEmail: settings.supportEmail,
  });

  const from = `"${c.smtp_from_name || settings.portalName}" <${c.smtp_from_email || c.smtp_user}>`;
  await makeTransport(c).sendMail({
    from,
    to:      service.cust_email,
    subject: `${copy.emoji} Repair Update — ${service.id} is now "${newStatus}"`,
    html,
  });
}

// ── Public: send a test email (used from admin settings) ─────────────────────
async function sendTestEmail(to) {
  const c = cfg();
  if (!c.smtp_host || !c.smtp_user) throw new Error('SMTP is not configured yet');

  const portalName = db.prepare(`SELECT value FROM settings WHERE key='portal_name'`).get()?.value || 'Reparo';
  const from = `"${c.smtp_from_name || portalName}" <${c.smtp_from_email || c.smtp_user}>`;

  const safeName = esc(portalName);
  await makeTransport(c).sendMail({
    from,
    to,
    subject: `✅ SMTP Test — ${portalName}`,
    html: `<p style="font-family:sans-serif;font-size:15px;color:#111">
      Your SMTP settings are working correctly.<br><br>
      <strong>${safeName}</strong> will use this configuration to send status notifications to customers.
    </p>`,
  });
}

module.exports = { sendStatusNotification, sendTestEmail };
