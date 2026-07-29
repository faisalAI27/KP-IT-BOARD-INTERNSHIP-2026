# KP AWAZ visual identity

The designer-supplied PNG artwork in `frontend/assets/images/brand/` is the source of truth. Do not redraw, retype, trace, recolour, crop, stretch, or add effects to these files.

## Approved lockups

| Asset | Intrinsic size | Approved use |
| --- | ---: | --- |
| `kp-awaz-lockup-horizontal-on-light.png` | 3403 × 536 | Public header, light page headers, light administration surfaces |
| `kp-awaz-lockup-horizontal-on-dark.png` | 3403 × 536 | Public footer, contributor sidebar, dark brand panels |
| `kp-awaz-lockup-stacked-on-light.png` | 3562 × 2084 | Authentication, password recovery, larger light-background placements |

The tagline is part of the approved artwork and must remain exactly:

> Preserving Languages. Empowering AI

Do not repeat the tagline as nearby HTML text. The stacked lockup must not be used in the compact public header, and the three variants must not be displayed together on the landing page.

## Colour system

| Token | Value | Use |
| --- | --- | --- |
| `--brand-navy` | `#001A33` | Dark institutional surfaces and high-contrast actions |
| `--brand-green` | `#3BC3B2` | KPITB mint emphasis, statistics, active states, and primary controls |
| `--brand-blue` | `#33679A` | KPITB institutional blue, focus and secondary accents |
| `--brand-grey` | `#9D9D9D` | Restrained neutral details |
| `--brand-white` | `#FFFFFF` | Light surfaces and reverse artwork |
| `--brand-gradient` | mint → deep navy | KPITB programme-section treatment; never apply it to the logo image itself |
| `--surface-page` | `#F7FAFB` | Calm application and public-page canvas |
| `--surface-section` | `#F1F6F7` | Quiet section and inactive-control surface |
| `--surface-mint` | `#EDF8F6` | Selected, recommended, and consent surfaces |
| `--surface-blue` | `#F0F5F9` | Institutional information surfaces |
| `--surface-card` | `#FFFFFF` | Primary card and form surface |
| `--surface-card-hover` | `#FBFDFD` | Subtle nested and hover surface |
| `--text-primary` | `#162B34` | Standard high-contrast text on light surfaces |
| `--text-secondary` | `#586B74` | Supporting copy |
| `--text-muted` | `#60737D` | Compact labels and metadata |
| `--border-soft` | navy at 8% | Quiet dividers and card boundaries |
| `--border-default` | navy at 13% | Inputs and stronger boundaries |

The interface palette and mint-to-navy gradient were measured from the live
KPITB website. The approved KP AWAZ PNG artwork keeps its own embedded colours
unchanged. The strongest identity values are reserved for primary actions,
selected states, the contributor navigation, and occasional dark anchor
sections. Most interface area uses the derived light surfaces above. Dark
mint values remain available when compact mint text needs stronger contrast.
Bootstrap red and green remain reserved for errors/destructive actions and
confirmed success states.

## Typography

KP AWAZ uses the same split typography observed on the live KPITB website:

- `UniNeue` for headings, body copy, statistics, buttons, contributor
  interfaces and administration content;
- `Inter` for public navigation and compact utility/listing labels;
- the existing Pashto font stack for Pashto and other Arabic-script content.

The locally hosted font files in `frontend/assets/fonts/kpitb/` mirror the
files loaded by the reference site. Standard body copy is 16px/24px. The
interface scale uses 13px compact metadata, 14px supporting labels, 16px body
copy, 18–24px compact headings, 32px feature headings, 44px section headings,
and 56px product-page headings. A 64px display size remains available only
for the largest public storytelling headline when its supporting copy is at
least 16px.

## Frontend implementation

Use a named lockup inside a link with an explicit accessible name:

```html
<a href="index.html" aria-label="KP AWAZ home">
  <img
    src="assets/images/brand/kp-awaz-lockup-horizontal-on-light.png"
    width="3403"
    height="536"
    alt=""
  />
</a>
```

When a surrounding link already has an accessible name, keep `alt=""` to avoid duplicate announcements. Preserve the intrinsic `width` and `height` attributes to reserve layout space, then control display size with CSS and `height: auto`.

### Display guidance

- Public header: approximately 220–270px desktop, 190–230px tablet, and 155–190px mobile.
- Footer: large enough for the embedded tagline to remain readable, normally 230–270px.
- Contributor sidebar: fit within the sidebar’s available width without cropping.
- Authentication and recovery: use the stacked lockup at a balanced size that keeps the form visible on laptop and mobile screens.
- Maintain clear space around each lockup and a minimum 44px interactive area for linked logos.

## Favicon limitation

The current legacy favicon remains temporarily because the supplied system has no approved square or icon-only asset. It is not part of the new approved identity and must not be reused as visible page branding.

A designer-approved square/icon-only KP AWAZ mark is still required for the favicon, app icon and very small placements.

## Do not

- redraw or reconstruct the artwork with HTML, CSS, SVG tracing, or typed text;
- crop the waveform, wordmark, or tagline;
- change individual logo colours or typography;
- add borders, shadows, glows, filters, gradients, or animation directly to the logo;
- distort the aspect ratio;
- place the light-background lockup on dark surfaces or the dark-background lockup on pale surfaces;
- use the legacy Khyber Voice artwork in visible product branding.
