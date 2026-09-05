import { env } from './env.js';

/**
 * Shared shell for every transactional email.
 *
 * Email clients are not browsers: Outlook still renders through Word, Gmail
 * strips <style> blocks in some views, and flexbox/grid are unusable. So this
 * is table-based with inline styles only, 600px wide, and every colour stated
 * explicitly so a client's dark mode cannot invert half a layout.
 *
 * The palette matches the site: neutral greys, with colour reserved for
 * meaning (green = confirmed, red = needs attention).
 */

const INK = '#171614';
const SLATE = '#55534e';
const MUTE = '#8b8881';
const LINE = '#dedcd7';
const SAND = '#f4f4f2';
const PAPER = '#ffffff';
export const OK = '#2f6f4f';
export const ALERT = '#a3352b';

// Georgia stands in for the site's display serif — webfonts do not load in
// most mail clients, and Georgia ships on effectively every device.
const DISPLAY = "Georgia, 'Times New Roman', serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ADDRESS = 'Jewel Complex, Room 220, 2nd Floor, TRM Drive, Nairobi';

/** Escape anything that came from a user before it goes near an HTML email. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function money(n: number): string {
  return `KES ${Number(n).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Solid call-to-action. Built as a table so Outlook renders the fill. */
export function button(href: string, label: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px">
    <tr>
      <td align="center" bgcolor="${INK}" style="border-radius:6px">
        <a href="${esc(href)}"
           style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">
          ${esc(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/** A large monospaced code, for one-time passwords. */
export function codePanel(code: string, caption: string): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0">
    <tr>
      <td align="center" bgcolor="${SAND}" style="border:1px solid ${LINE};border-radius:8px;padding:26px 20px">
        <div style="font-family:${SANS};font-size:12px;color:${MUTE};margin-bottom:12px">${esc(caption)}</div>
        <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${INK};margin-left:10px">${esc(code)}</div>
      </td>
    </tr>
  </table>`;
}

/**
 * Label / value rows, ruled like the strip on the site's hero card.
 *
 * Labels are escaped here, but VALUES are treated as HTML so a row can carry
 * a coloured status. Every call site must therefore pass user data through
 * `esc()` itself.
 */
export function factTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value], i) => `
      <tr>
        <td style="padding:12px 0;${i ? `border-top:1px solid ${LINE};` : ''}font-family:${SANS};font-size:14px;color:${MUTE};width:42%;vertical-align:top">${esc(label)}</td>
        <td style="padding:12px 0;${i ? `border-top:1px solid ${LINE};` : ''}font-family:${SANS};font-size:14px;font-weight:600;color:${INK};text-align:right;vertical-align:top">${value}</td>
      </tr>`
    )
    .join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}">
    ${body}
  </table>`;
}

/** A quiet aside — expiry warnings, "ignore this if it wasn't you", etc. */
export function note(text: string): string {
  return `<p style="margin:20px 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTE}">${text}</p>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:${SLATE}">${text}</p>`;
}

interface ShellOptions {
  /** Shown in the inbox preview line, after the subject. */
  preheader: string;
  heading: string;
  /** Pre-built HTML — compose with the helpers above. */
  body: string;
}

export function shell({ preheader, heading, body }: ShellOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${SAND};-webkit-text-size-adjust:100%">

  <!-- inbox preview text, then blanks so the body copy does not follow it -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">
    ${esc(preheader)}${'&#8199;&#65279;&#847; '.repeat(60)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SAND}">
    <tr>
      <td align="center" style="padding:32px 16px">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:100%;max-width:600px;background:${PAPER};border:1px solid ${LINE};border-radius:12px">

          <!-- Brand -->
          <tr>
            <td style="padding:28px 32px 22px;border-bottom:1px solid ${LINE}">
              <div style="font-family:${DISPLAY};font-size:22px;font-weight:700;color:${INK};letter-spacing:-0.01em">Tiuri</div>
              <div style="font-family:${SANS};font-size:12px;color:${MUTE};margin-top:3px">Nails &amp; Wigs Parlour</div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:32px">
              <h1 style="margin:0 0 18px;font-family:${DISPLAY};font-size:26px;line-height:1.25;font-weight:700;color:${INK}">${esc(heading)}</h1>
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 32px 26px;border-top:1px solid ${LINE};background:${SAND};border-radius:0 0 12px 12px">
              <p style="margin:0 0 6px;font-family:${SANS};font-size:13px;color:${SLATE}">${ADDRESS}</p>
              <p style="margin:0 0 14px;font-family:${SANS};font-size:13px;color:${MUTE}">Open Monday to Saturday, 9am – 7pm</p>
              <p style="margin:0;font-family:${SANS};font-size:12px;color:${MUTE}">
                <a href="${esc(env.FRONTEND_URL)}" style="color:${SLATE};text-decoration:underline">tiuri.co.ke</a>
                &nbsp;·&nbsp; This message was sent to you because you have an account or a booking with us.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
