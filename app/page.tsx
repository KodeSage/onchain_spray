import Arena from "./Arena";

/**
 * One page, one arena, no rooms.
 *
 * A server shell so the metadata and fonts are static, with everything that
 * touches a key or a socket below it in a client component.
 */
export default function Home() {
  return <Arena />;
}
