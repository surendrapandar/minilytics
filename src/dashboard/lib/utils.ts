/** Join class names, skipping falsy ones. */
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
