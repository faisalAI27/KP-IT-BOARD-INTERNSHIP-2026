# KP AWAZ visual identity

## A. Recommended concept — The Voice Gateway

The KP AWAZ mark is a compact cultural gateway containing two mountain peaks and one continuous voice line. It represents a welcoming place where regional voices enter the digital future without turning the brand into a microphone, tourism badge, or government seal.

The full name is always written as **KP AWAZ**. `AWAZ` carries the strongest visual weight, while the smaller gold `KP` keeps the regional identity present without competing with the platform name.

## B. Why it fits KP AWAZ

- It begins with community and place, not technology.
- The hujra-inspired arch suggests hospitality, gathering, and a shared cultural home.
- The mountain peaks identify Khyber Pakhtunkhwa without using a map or scenic illustration.
- The waveform is structurally integrated with the mountain base, connecting place and voice in one gesture.
- The small woven diamond is a restrained textile-inspired detail and a digital point: a voice preserved as a durable cultural record.
- The silhouette stays recognizable at favicon and profile-icon sizes.

## C. Shape breakdown

| Element | Meaning |
| --- | --- |
| Outer arch | Cultural gateway, hujra, welcome, community gathering |
| Twin peaks | KP landscape, continuity, regional identity |
| Continuous wave | Speech, recording, listening, living languages |
| Central diamond | Textile geometry, one preserved contribution, a future-facing data point |
| Strong base | Trust, dignity, permanence |

The symbol uses flat shapes, one rounded waveform, and no gradients. Its geometry is intentionally compact so it remains clear in navigation, contributor tools, printed documents, and social avatars.

## D. Color direction

| Role | Color | Use |
| --- | --- | --- |
| Forest green | `#153F32` | Trust, dignity, gateway, primary wordmark |
| Terracotta | `#B65D3A` | Earth, homes, regional craft, mountain form |
| Muted gold | `#C89943` | Warmth, cultural value, the `KP` accent |
| Warm ivory | `#F7F1E6` | Human warmth, breathing room, waveform contrast |

The palette connects directly to the existing KP AWAZ interface. Use flat color only; the logo must never receive a gradient, bevel, neon glow, or color effect.

## E. Typography direction

The master primary wordmark is converted to vector outlines from Georgia Bold, so it does not depend on a visitor having the font installed. The serif structure feels serious, editorial, and culturally warm rather than futuristic. Supporting interface text should remain in the current clean sans-serif stack for clarity.

Do not redraw, stretch, retype, or alter the spacing of the outlined master wordmark.

## F. Logo variations

| Asset | Purpose |
| --- | --- |
| `assets/images/logo-primary.svg` | Master full-color symbol and outlined wordmark; default choice |
| `assets/images/logo-horizontal.svg` | Compact one-line lockup for narrow headers and partner rows |
| `assets/images/logo.svg` | Icon-only mark for favicon, app icon, avatar, and small UI placements |
| `assets/images/logo-stacked.svg` | Centered layouts, social graphics, covers, and presentation title pages |
| `assets/images/logo-monochrome-dark.svg` | One-color production on white or pale backgrounds |
| `assets/images/logo-monochrome-light.svg` | One-color production on dark green, dark photography, or black |

The optional tagline, **Our voices, our language, our Khyber Pakhtunkhwa.**, stays separate from the logo. It must not be placed inside the symbol.

## G. Frontend implementation

Use the primary lockup in light public navigation:

```html
<a href="index.html" aria-label="KP AWAZ home">
  <img src="assets/images/logo-primary.svg" width="141" height="42" alt="" />
</a>
```

Use the light monochrome lockup on the dark contributor sidebar:

```html
<img src="assets/images/logo-monochrome-light.svg" width="141" height="42" alt="" />
```

Use the mark for favicons and compact icons:

```html
<link rel="icon" href="assets/images/logo.svg" type="image/svg+xml" />
```

When the surrounding link already has an accessible name such as `aria-label="KP AWAZ home"`, keep the image `alt` empty to avoid duplicate announcements. A standalone logo image should use `alt="KP AWAZ"`.

### Size and spacing

- Primary or horizontal lockup: minimum displayed width `120px` on screen.
- Icon-only mark: minimum displayed size `24px`; prefer `32px` or larger.
- Keep clear space around every logo equal to at least one half of the arch's inner width.
- Preserve the SVG aspect ratio with `height: auto` or the matching intrinsic width and height.

### Do not

- place the full-color mark on a visually busy background without sufficient contrast;
- recolor individual elements outside the approved palette;
- add a microphone, map, flag, seal, circuit, or extra ornament;
- rotate, crop, skew, outline, or add drop shadows to the symbol;
- place other text inside the required clear space.
