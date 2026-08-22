/**
 * `??` only catches an unset variable. Vercel hands the build an empty string
 * for any variable that exists in the dashboard with a blank value, and `""`
 * flows straight into parsers that throw — `new URL("")`, `parseEther("")`.
 * At module scope that throw fails the production build, not the request.
 *
 * Treat blank as unset, everywhere.
 */
export function envOr(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}
