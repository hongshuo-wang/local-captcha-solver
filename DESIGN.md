# Design System: Captcha Helper

## Product Character

Captcha Helper is a quiet browser utility. It should feel dependable, local, and easy to dismiss after the job is done. The interface must never resemble an AI dashboard or a security alarm.

- Density: 5/10, compact enough for repeated use without feeling crowded.
- Variance: 3/10, predictable alignment with small asymmetric details for hierarchy.
- Motion: 3/10, limited to direct feedback and state changes.
- Theme: follows the browser or operating system. Light and dark modes use the same hierarchy.

## Color Roles

### Light

- Canvas Mist (`#F2F5F3`): page and popup background.
- Surface (`#FCFDFC`): primary content surface.
- Surface Muted (`#E8EEEA`): navigation and quiet controls.
- Forest Ink (`#17241F`): primary text.
- Muted Moss (`#637069`): supporting text.
- Hairline (`#D5DDD8`): structural borders.
- Forest Action (`#256447`): the only accent, used for primary actions and active states.
- Forest Action Hover (`#1C5038`): hover and pressed state.
- Warning (`#8A671E`): ambiguity that needs a decision.
- Danger (`#A13F3A`): recognition and permission failures.

### Dark

- Canvas (`#171D1A`): page and popup background.
- Surface (`#222A26`): primary content surface.
- Surface Muted (`#2B3530`): navigation and quiet controls.
- Primary Text (`#EEF3F0`): primary text.
- Muted Text (`#ADB8B1`): supporting text.
- Hairline (`#414C46`): structural borders.
- Forest Action (`#6EAF8A`): accent text and active state.
- Primary Button (`#377A57`): filled action surface.

## Typography

- UI: `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI Variable`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`, sans-serif.
- Results, domains, times, and diagnostics: `ui-monospace`, `SFMono-Regular`, `Cascadia Code`, `Roboto Mono`, monospace.
- Letter spacing is always `0`.
- Popup title: 15px/20px, 700.
- Product page title: 32-40px, 680, balanced wrapping.
- Section title: 16-18px, 680.
- Body: 13-14px with 1.55-1.7 line height.
- Captions: 11-12px. Never rely on captions for required instructions.

## Shape And Depth

- Content surfaces: 8px radius.
- Inputs and buttons: 6px radius.
- Switch tracks: full radius because the shape communicates the control.
- Popup recognition panels: 8px radius with one tinted shadow.
- Avoid decorative cards. Use spacing and hairlines for page sections.
- Never nest cards.

## Interaction Rules

- The popup has exactly one primary command: recognize the current page.
- Site enablement is a secondary switch and permission state.
- New onboarding starts with neither access choice selected. Continue remains disabled until the user chooses.
- The final onboarding action is `完成设置并关闭` / `Finish setup and close`.
- Success and copy feedback are transient toasts.
- Ambiguity, permission errors, existing field values, and other decisions remain visible until dismissed or acted on.
- Persistent page panels prefer the side of the CAPTCHA or input, then a position outside the form. On narrow screens they become a bottom status bar.
- Recognition UI must not cover submit, login, CAPTCHA refresh, or other form controls.
- Normal UI never displays raw confidence percentages. Diagnostics may retain them.
- The extension never submits forms.

## States

- Loading: stable-size status text and a quiet pulsing indicator.
- Success: brief green confirmation with the recognized value when useful.
- Warning: persistent panel with one clear primary action and optional copy action.
- Error: persistent panel with a retry action when recovery is possible.
- Empty: plain, helpful text inside the existing section, not an illustration card.
- Disabled: reduced contrast with a clear reason adjacent to the control.

## Accessibility

- Interactive targets are at least 40px in desktop settings and 44px on touch layouts.
- Every keyboard target has a 2px forest focus ring with 2-3px offset.
- Body and control text meet WCAG AA contrast in both themes.
- Status changes use polite live regions. Actions remain keyboard reachable.
- Reduced-motion mode removes entry and pulse animation without changing information.

## Store Artwork

- Use real product screenshots and real recognition states as the main visual evidence.
- Promotional tiles may frame or crop the product, but must not invent controls or model claims.
- Keep the forest identity and off-white surfaces. Use one muted yellow only inside a CAPTCHA sample when it is part of the example image.
- No purple gradients, neon effects, generic AI imagery, fake dashboards, decorative data, or confidence claims.
