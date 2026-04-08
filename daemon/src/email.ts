// ─── Email transport (daemon) ──────────────────────────────────────────────────
// Stripped-down version of billing-api/src/email.ts.
// Primary: Gmail SMTP via nodemailer.
// No SendGrid fallback here — if Gmail fails, log and swallow (daemon is not
// user-facing; missed digests are acceptable, missing alerts log to stderr).

import nodemailer from "nodemailer";
import { GMAIL_USER } from "./config.js";

function getTransport(): nodemailer.Transporter {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) throw new Error("GMAIL_APP_PASSWORD not set");
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass },
  });
}

export async function sendEmail(opts: {
  to:      string;
  subject: string;
  text:    string;
  html:    string;
}): Promise<void> {
  const transport = getTransport();
  await transport.sendMail({
    from:    `Security Orchestra Daemon <${GMAIL_USER}>`,
    to:      opts.to,
    subject: opts.subject,
    text:    opts.text,
    html:    opts.html,
  });
}
