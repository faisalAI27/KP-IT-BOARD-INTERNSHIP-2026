# KPITB live visual audit

Inspected on 29 July 2026 from the rendered production site at
<https://www.kpitb.gov.pk/>. This audit was captured before changing the
KP AWAZ visual system.

## Inspection method and coverage

- Browser: Google Chrome 150 in headless mode through the Chrome DevTools
  Protocol.
- Desktop viewport: 1440 × 1200 CSS pixels.
- Mobile viewport: 390 × 844 CSS pixels.
- Pages inspected: Home, About, Projects, Happenings, and Downloads.
- Additional surfaces inspected: homepage Latest Happenings, statistics,
  header, expanded mobile navigation, buttons, cards, contact banner, and
  footer.
- Values below are live `getComputedStyle()` results. The official
  `style.css`, `fonts.css`, and responsive stylesheets were also inspected to
  verify font files, CSS variables, gradients, spacing, and breakpoints.

## Typography

The live site does not use one font everywhere:

- `UniNeue` is the institutional display and content face. The site loads
  `UniNeue-Trial-Bold.ttf`, `UniNeue-Trial-Heavy.ttf`,
  `UniNeue-Trial-Regular.ttf`, and `UniNeue-Trial-Light.ttf`.
- `Inter` is used for main navigation, news/listing cards, and selected
  utility/legal text. The live site loads the Inter variable webfont.
- Bootstrap's system stack remains on unoverridden utility elements.

| Element inspected | Font family | Size | Weight | Line height | Letter spacing | Transform | Colour |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Body root | system UI stack | 16px | 400 | 24px | normal | none | `#212529` |
| Desktop navigation link | Inter | 13px | 400 | 19.5px | normal | none | `#000000` |
| Mobile navigation link | Inter | 14px | 400 | 21px | normal | none | `#000000` |
| Homepage hero heading | UniNeue | 64px | 700 | 76.8px | normal | none | `#FFFFFF` |
| Homepage section heading, “Latest Happenings” | UniNeue | 48px | 700 | 48px | normal | none | `#FFFFFF` |
| Institutional content heading | UniNeue | 43.2px | 700 | 51.84px | normal | none | `#3BC3B2` |
| About/Downloads page heading | UniNeue | 48px | 700–800 | 57.6px | normal | none | `#3BC3B2` |
| Project-category heading | UniNeue | 28.8px | 600 | 28.8px | normal | none | `#3BC3B2` |
| Happenings card heading | Inter | 19.2px | 600 | 23.04px | normal | none | `#212529` |
| Standard body paragraph | UniNeue | 16px | 400 | 24px | normal | none | `#212529` |
| Featured/supporting paragraph | UniNeue | 17.6px | 100 | 26.4px | normal | none | context colour |
| Small result/support label | system UI stack | 14px | 400 | 21px | normal | none | `#6C757D` |
| Primary button text | UniNeue | 16px | 400 | 24px | normal | none | `#000000` |
| Statistics number | UniNeue | 64px | 900 | 64px | normal | none | `#3BC3B2` |
| Statistics label | UniNeue | 19.2px | 700 | 23.04px | normal | none | `#3BC3B2` |
| Footer heading | UniNeue | 20px | 600 | 24px | normal | none | `#FFFFFF` |
| Footer paragraph | UniNeue | 16px | 400 | 24px | normal | none | `#FFFFFF` |

No dedicated visible eyebrow component was present on the sampled live pages.
The closest live small-label treatment is the Happenings result count shown
above. The stylesheet defines `.sectionLabel` as UniNeue 400, uppercase and
centred, but the sampled pages did not render one for a reliable computed
colour/size reading.

## Colour system

### Authored institutional colours

| Role | Live value | Evidence and use |
| --- | --- | --- |
| Primary mint | `#3BC3B2` | `--green`; headings, statistics, active states, buttons |
| Deep navy | `#001A33` | Main gradient endpoint and dark institutional surfaces |
| Deep navy variant | `#001A34` | News gradient endpoint |
| Institutional blue | `#33679A` | `--blue`; secondary institutional accent |
| White | `#FFFFFF` | Navigation surface and text on dark/gradient sections |
| Near-black text | `#212529` | Default Bootstrap body and content text |
| Black | `#000000` | Navigation and mint-button text |
| Light surface | `#F9F9F9` | Alternating section background |
| Secondary light surface | `#F1F1F1` | Project/listing surface |
| Muted text | `#6C757D` | Supporting counts and utility text |
| Light border | `#ECECEC` | Quiet dividers and card boundaries |
| Mid border | `#D4D4D4` | Secondary boundaries |

Bootstrap utility colours such as `#0D6EFD` remain present on unoverridden
links, but they are framework defaults rather than the core institutional
identity. KP AWAZ should use the authored mint, navy and blue roles for its
primary visual system.

### Live gradients and overlays

- Digital programme section:
  `linear-gradient(205deg, #3BC3B2 0%, #001A33 90.26%)`
- Latest Happenings:
  `linear-gradient(251.19deg, #3BC3B2 -11.64%, #001A34 91.73%)`
- Dark cards: `rgba(0, 0, 0, 0.1)` with
  `rgba(255, 255, 255, 0.1)` borders.
- Light-on-dark feature cards: `rgba(255, 255, 255, 0.1)`.
- Download-card overlay: `rgba(0, 0, 0, 0.7)`.

## Scale, shape, and density

- Desktop content is calm and wide: the main content width is approximately
  1296px inside a 1440px viewport.
- General section spacing is `100px 20px`.
- Homepage hero has an 880px minimum height.
- Programme section padding is 50px; news section padding is 40px.
- Feature-card internal padding is commonly 20–30px.
- Large feature cards use a 20px radius.
- Primary buttons are 46px high, at least 180px wide, use 10px × 20px
  padding, and have an 8px radius.
- The desktop header is a white floating pill with a 50px radius and a soft
  black shadow.
- Visual hierarchy is created mainly through scale, whitespace, mint
  headings and navy gradients rather than numerous bordered cards.

## Mobile header and navigation

At 390px:

- The viewport and document width both remain 390px with no horizontal
  overflow.
- The white navigation container is 370px wide with `10px 30px` padding and
  a 20px radius.
- The logo is 227 × 53px.
- The mint menu button is 56 × 40px.
- Expanded navigation is 310px wide.
- Mobile navigation links use Inter at 14px/21px with 8px vertical padding.

## KP AWAZ migration decisions

- Continue using only the approved KP AWAZ lockups.
- Use locally hosted UniNeue for institutional headings and content, with
  Inter for navigation and compact data/listing labels.
- Preserve 16px/24px as the standard content rhythm.
- Use the 64/48/32/20/16 scale as the desktop reference, reduced fluidly on
  smaller screens.
- Replace the current KP AWAZ brand-theme colours with KPITB's mint, deep
  navy, blue, white, neutral text and quiet light surfaces.
- Reuse the live site's restrained mint-to-navy gradient selectively for
  primary institutional surfaces, not every component.
- Keep existing KP AWAZ accessibility, routes, forms, state handling,
  recording interactions, contributor workflows and administration
  behavior unchanged.
