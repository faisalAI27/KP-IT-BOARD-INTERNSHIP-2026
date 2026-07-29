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
| `--brand-navy` | `#002533` | Primary text, dark surfaces, high-contrast actions |
| `--brand-green` | `#00BE83` | Waveform identity, decorative emphasis, progress and success accents |
| `--brand-blue` | `#00A0EF` | Waveform identity, information and secondary accents |
| `--brand-grey` | `#A8A8A8` | Logo tagline and restrained neutral details |
| `--brand-white` | `#FFFFFF` | Light surfaces and reverse artwork |
| `--brand-gradient` | green → blue | Brand-led decorative fills; never apply it to the logo image itself |

Darkened green and blue supporting tokens are provided for accessible text and controls. The bright approved green and blue should not be used for small text on white when contrast would be insufficient. Red remains reserved for errors, destructive actions, and rejected contributions.

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
