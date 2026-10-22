/**
 * The few icons the HUD needs, drawn for this game: thick ink strokes with round ends,
 * like the outlined buttons and cards they sit in. Text labels carry everything else.
 */
const PATHS = {
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  book: '<path d="M12 6.5C10.3 5 7.8 4.5 4 4.8V18c3.8-.3 6.3.2 8 1.7 1.7-1.5 4.2-2 8-1.7V4.8c-3.8-.3-6.3.2-8 1.7zM12 6.5v13"/>',
  wrench: '<path d="M14.6 3.6a4.6 4.6 0 0 0-4.2 6.3l-6 6a2.1 2.1 0 0 0 3 3l6-6a4.6 4.6 0 0 0 6.3-4.2l-2.9 1.1-2.4-.9-.9-2.4z"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
  flask: '<path d="M9 3h6M10.3 3v6.2L5 18.4A1.8 1.8 0 0 0 6.6 21h10.8a1.8 1.8 0 0 0 1.6-2.6L13.7 9.2V3M7.4 15h9.2"/>',
  notebook: '<rect x="6" y="3" width="13.5" height="18" rx="2"/><path d="M4 7.5h4M4 12h4M4 16.5h4M11 8h5"/>',
  gear: '<circle cx="12" cy="12" r="7.6" stroke-width="3.6" stroke-dasharray="2.98 3"/><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  loop: '<path d="M4.5 11.5a7.5 7.5 0 0 1 13.2-4.8M18.5 3v4h-4M19.5 12.5a7.5 7.5 0 0 1-13.2 4.8M5.5 21v-4h4"/>',
  wagon: '<path d="M2.5 8.5h14.5l-1.6 7H4.2zM17 8.5l4-4"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="14" cy="18.5" r="2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Inline SVG markup, sized by CSS (`svg.i`), drawn in the current text colour. */
export function icon(name: IconName): string {
  return `<svg class="i i-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
