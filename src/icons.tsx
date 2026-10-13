// Line icons in the SF Symbols spirit: 20px grid, 1.6 stroke, currentColor.
const paths = {
  link: "M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1",
  folder: "M2.5 6V15a1.5 1.5 0 0 0 1.5 1.5h12A1.5 1.5 0 0 0 17.5 15V7.5A1.5 1.5 0 0 0 16 6H9.5L8 4H4A1.5 1.5 0 0 0 2.5 5.5Z",
  gear: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4",
  tray: "M10 3v9M6.5 8.5 10 12l3.5-3.5M3 12.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15v-2.5",
  clock: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 6v4l2.5 2",
  check: "M4.5 10.5 8 14l7.5-8",
  warn: "M10 3 2.5 16.5h15ZM10 8.5v3.5M10 14.4v.1",
  globe: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM2.5 10h15M10 2.5c2 2 3 4.5 3 7.5s-1 5.5-3 7.5c-2-2-3-4.5-3-7.5s1-5.5 3-7.5Z",
  play: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM8.5 7v6l5-3Z",
  x: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  reveal: "M8.5 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM12.5 12.5 17 17",
  retry: "M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5v3.5H12",
  film: "M3 4.5h14v11H3ZM6 4.5v11M14 4.5v11M3 8h3M3 12h3M14 8h3M14 12h3",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  );
}
