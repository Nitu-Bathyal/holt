"""The one template every Holt email is built from (alert_email.py,
account_email.py): the frame and the parts that go in it.

The frame, top to bottom: a dark band with the cat and the wordmark as live
text, a rule under it in the email's tone, one card (a headline, 16px body,
item cards, one solid button), and a quiet footer. The colours are the
site's (web/src/app/globals.css), light and dark.

What mail clients need, kept in one place:

- one 600px column of tables, every style inline (Gmail and Outlook drop
  <style>), MSO conditionals for Outlook on Windows;
- the <style> block only adds dark mode and phone padding, so a client that
  strips it still gets the full light design. The band is dark in both, so a
  client that inverts colours by itself leaves it alone;
- buttons are table cells with a background, not images or CSS shapes;
- no images, no tracking pixel, no link tracking;
- every string escaped (pull request titles are other people's text), every
  link absolute.

Everything here returns table rows (`<tr>`) for the card, except `shell`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    preheader: str
    html: str
    text: str


# The site's tokens (web/src/app/globals.css). `--line` is translucent there;
# these are what it comes to on the page and panel colours.
BG, CARD, TINT = "#f5f2ec", "#fffdf8", "#f8f6f1"
LINE, LINE_STRONG = "#e2ddd3", "#c9c4ba"
INK, MUTED, FAINT = "#111723", "#586071", "#6b7180"
BLUE, GREEN, ON_GREEN = "#1f48cf", "#0b6a4d", "#ffffff"
# The band: the site's ink, with the dark theme's blue and ink on it.
BAND, BAND_CAT, BAND_INK = "#111723", "#83a9ff", "#f5f2ec"
DARK = {"bg": "#0d0e0e", "card": "#141615", "tint": "#1a1c1b", "line": "#292b29",
        "lineStrong": "#3b3e3a", "ink": "#e7e5dc", "muted": "#a3a39b", "faint": "#8a8a83",
        "blue": "#83a9ff", "green": "#69c7a6", "onGreen": "#0d0e0e", "band": "#1a1c1b"}
# tone -> (light, dark): the rule under the band and down an item card's
# side. As on My PRs: your turn and the stale bot (orange), past normal and
# plain news (blue), good news (green), closed (grey).
RULE = {"turn": ("#b23c0b", "#ee925d"), "stale": ("#b23c0b", "#ee925d"),
        "late": ("#1f48cf", "#83a9ff"), "good": ("#0b6a4d", "#69c7a6"),
        "done": ("#c9c4ba", "#3b3e3a")}
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
CAT = "(=^•ω•^=)"

Link = tuple[str, str]  # label, href


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _head(subject: str) -> str:
    d = DARK
    rules = "\n      ".join(
        f".h-rule-{t} {{ border-left-color: {RULE[t][1]} !important; }}\n      "
        f".h-tone-{t} {{ border-bottom-color: {RULE[t][1]} !important; }}" for t in RULE)
    return f"""<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{esc(subject)}</title>
  <!--[if mso]><style>table, td, p, a, span, h1 {{ font-family: Arial, sans-serif !important; }}</style><![endif]-->
  <style>
    :root {{ color-scheme: light dark; supported-color-schemes: light dark; }}
    @media (max-width: 620px) {{
      .h-pad {{ padding-left: 24px !important; padding-right: 24px !important; }}
      .h-outer {{ padding: 0 !important; }}
      .h-h1 {{ font-size: 25px !important; line-height: 31px !important; }}
    }}
    @media (prefers-color-scheme: dark) {{
      .h-bg {{ background: {d['bg']} !important; }}
      .h-band {{ background: {d['band']} !important; }}
      .h-card {{ background: {d['card']} !important; border-color: {d['line']} !important; }}
      .h-item {{ background: {d['tint']} !important; border-color: {d['line']} !important; }}
      .h-ink {{ color: {d['ink']} !important; }}
      .h-muted {{ color: {d['muted']} !important; }}
      .h-faint {{ color: {d['faint']} !important; }}
      .h-link {{ color: {d['blue']} !important; }}
      .h-divider {{ border-top-color: {d['line']} !important; }}
      .h-btn {{ background: {d['green']} !important; }}
      .h-btn a {{ color: {d['onGreen']} !important; }}
      .h-ghost {{ border-color: {d['lineStrong']} !important; }}
      .h-ghost a {{ color: {d['ink']} !important; }}
      {rules}
    }}
    [data-ogsc] .h-ink, [data-ogsc] .h-ghost a {{ color: {d['ink']} !important; }}
    [data-ogsc] .h-muted {{ color: {d['muted']} !important; }}
    [data-ogsc] .h-faint {{ color: {d['faint']} !important; }}
    [data-ogsc] .h-link {{ color: {d['blue']} !important; }}
    [data-ogsb] .h-bg {{ background: {d['bg']} !important; }}
    [data-ogsb] .h-card {{ background: {d['card']} !important; }}
    [data-ogsb] .h-item {{ background: {d['tint']} !important; }}
  </style>
</head>"""


def _preheader(text: str) -> str:
    """Shown in the inbox list after the subject, then hidden; the spacer
    stops the body leaking in after it."""
    spacer = "&#847;&zwnj;&nbsp;" * 60
    return (f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;'
            f'line-height:1px;color:{BG};opacity:0;">{esc(text)}{spacer}</div>')


def shell(subject: str, preheader: str, home_url: str, tone: str, rows: list[str],
          footer: list[str]) -> str:
    """The whole email. `tone` colours the rule under the band; `rows` are
    the card's rows, `footer` the footer's paragraphs (`footer_line`)."""
    card = "\n".join(rows)
    foot = "\n              ".join(footer)
    return f"""<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
{_head(subject)}
<body class="h-bg" style="margin:0;padding:0;background:{BG};-webkit-text-size-adjust:100%;">
  {_preheader(preheader)}
  <table role="presentation" class="h-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{BG}" style="border-collapse:collapse;background:{BG};">
    <tr>
      <td class="h-outer" align="center" style="padding:32px 16px 0 16px;">
        <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:600px;">
          <tr>
            <td class="h-band h-pad h-tone-{tone}" bgcolor="{BAND}" style="background:{BAND};padding:20px 40px 19px 40px;border-bottom:4px solid {RULE[tone][0]};">
              <a href="{esc(home_url)}" style="text-decoration:none;font-family:{MONO};font-size:17px;line-height:22px;">
                <span style="color:{BAND_CAT};letter-spacing:-1px;">{CAT}</span>&nbsp;&nbsp;<span style="color:{BAND_INK};font-weight:700;">holt</span>
              </a>
            </td>
          </tr>
          <tr>
            <td class="h-card" bgcolor="{CARD}" style="background:{CARD};border:1px solid {LINE};border-top:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
{card}
                <tr><td style="height:40px;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="h-pad" style="padding:24px 40px 44px 40px;font-family:{SANS};font-size:13px;line-height:20px;">
              {foot}
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>"""


def _row(top: int, inner: str) -> str:
    return f"""                <tr>
                  <td class="h-pad" style="padding:{top}px 40px 0 40px;">
                    {inner}
                  </td>
                </tr>"""


def heading(text: str) -> str:
    return _row(40, f'<h1 class="h-ink h-h1" style="margin:0;font-family:{SANS};font-size:28px;'
                    f'line-height:35px;font-weight:700;letter-spacing:-0.5px;color:{INK};">'
                    f'{esc(text)}</h1>')


def sub(text: str) -> str:
    """A muted line right under the heading: the daily email's date."""
    return _row(6, f'<p class="h-muted" style="margin:0;font-family:{SANS};font-size:15px;'
                   f'line-height:22px;color:{MUTED};">{esc(text)}</p>')


def para(text: str, top: int = 16) -> str:
    return _row(top, f'<p class="h-ink" style="margin:0;font-family:{SANS};font-size:16px;'
                     f'line-height:26px;color:{INK};">{esc(text)}</p>')


def button(href: str, label: str, solid: bool = True) -> str:
    """A button as a table (not a row). Solid: the email's one main action,
    in the site's green. Not solid: an outlined one, for an item's action
    when the email has several."""
    if solid:
        cell = f'class="h-btn" bgcolor="{GREEN}" style="background:{GREEN};mso-padding-alt:13px 24px;"'
        pad, colour = "13px 24px", ON_GREEN
    else:
        cell = (f'class="h-ghost" style="border:1px solid {LINE_STRONG};'
                f'mso-padding-alt:9px 16px;"')
        pad, colour = "9px 16px", INK
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="border-collapse:separate;"><tr><td {cell}>'
            f'<a href="{esc(href)}" style="display:inline-block;padding:{pad};font-family:{SANS};'
            f'font-size:{16 if solid else 15}px;line-height:22px;font-weight:600;color:{colour};'
            f'text-decoration:none;">{esc(label)}</a></td></tr></table>')


def link(href: str, label: str) -> str:
    return (f'<a class="h-link" href="{esc(href)}" style="color:{BLUE};'
            f'text-decoration:underline;">{esc(label)}</a>')


def button_row(href: str, label: str, top: int = 28) -> str:
    return _row(top, button(href, label))


def item(inner: str, tone: str = "late", top: int = 16) -> str:
    """An item card: a tinted box with the tone's rule down its side.
    `inner` is HTML (already escaped)."""
    return _row(top, f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                      <tr>
                        <td class="h-item h-rule-{tone}" bgcolor="{TINT}" style="background:{TINT};border:1px solid {LINE};border-left:4px solid {RULE[tone][0]};padding:18px 20px 20px 20px;">
                          {inner}
                        </td>
                      </tr>
                    </table>""")


def facts(pairs: list[tuple[str, str]]) -> str:
    """A label and value table, for inside an item card: a receipt's lines."""
    rows = "".join(
        f'<tr><td class="h-muted" valign="top" style="padding:{0 if i == 0 else 8}px 16px 0 0;'
        f'font-family:{SANS};font-size:14px;line-height:22px;color:{MUTED};white-space:nowrap;">'
        f'{esc(label)}</td><td class="h-ink" valign="top" style="padding:'
        f'{0 if i == 0 else 8}px 0 0 0;font-family:{SANS};font-size:15px;line-height:22px;'
        f'color:{INK};">{esc(value)}</td></tr>' for i, (label, value) in enumerate(pairs))
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="border-collapse:collapse;">{rows}</table>')


def points(rows: list[tuple[str, str | None, str]]) -> str:
    """A short list, for inside an item card: each row a bold title (a link
    when it has an href) and one line under it."""
    out = []
    for i, (title, href, line) in enumerate(rows):
        head = (f'<a class="h-ink" href="{esc(href)}" style="color:{INK};text-decoration:'
                f'underline;">{esc(title)}</a>' if href else esc(title))
        out.append(
            f'<p class="h-ink" style="margin:{0 if i == 0 else 16}px 0 0 0;font-family:{SANS};'
            f'font-size:16px;line-height:24px;font-weight:600;color:{INK};">{head}</p>'
            f'<p class="h-muted" style="margin:2px 0 0 0;font-family:{SANS};font-size:15px;'
            f'line-height:22px;color:{MUTED};">{esc(line)}</p>')
    return "\n                          ".join(out)


def small_print(lines: list[str], top: int = 32) -> str:
    """Muted small lines under a divider, at the end of the card: a receipt's
    payment details. Each line is HTML (already escaped)."""
    body = "".join(
        f'<p class="h-muted" style="margin:{0 if i == 0 else 4}px 0 0 0;font-family:{SANS};'
        f'font-size:13px;line-height:20px;color:{MUTED};">{line}</p>'
        for i, line in enumerate(lines))
    return _row(top, f'<div class="h-divider" style="padding-top:20px;border-top:1px solid '
                     f'{LINE};">{body}</div>')


def aside(text: str, top: int = 24) -> str:
    """One quiet line after the button."""
    return _row(top, f'<p class="h-muted" style="margin:0;font-family:{SANS};font-size:15px;'
                     f'line-height:22px;color:{MUTED};">{esc(text)}</p>')


def links_row(links: list[Link], top: int = 32) -> str:
    """Quiet links under a divider, at the end of the card."""
    joined = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;".join(link(href, label) for label, href in links)
    return _row(top, f'<p class="h-divider" style="margin:0;padding-top:20px;border-top:1px solid '
                     f'{LINE};font-family:{SANS};font-size:15px;line-height:22px;">{joined}</p>')


def footer_line(html: str, last: bool = False) -> str:
    """One paragraph of the footer. `html` is already escaped."""
    return (f'<p class="h-faint" style="margin:0{"" if last else " 0 6px 0"};color:{FAINT};">'
            f'{html}</p>')


def footer_link(href: str, label: str) -> str:
    return (f'<a class="h-faint" href="{esc(href)}" style="color:{FAINT};'
            f'text-decoration:underline;">{esc(label)}</a>')


def sent_to(to: str) -> str:
    """The footer's last line."""
    return footer_line(f"Sent to {esc(to)} by Holt, githolt.com", last=True)
