import type { ComponentProps } from 'react';

/** Use the browser's native navigation so every deep link works independently. */
export default function Link(props: ComponentProps<'a'>) {
  return <a {...props} />;
}
