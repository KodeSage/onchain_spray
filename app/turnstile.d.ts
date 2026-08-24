/**
 * Cloudflare Turnstile's explicit-render API.
 *
 * Hand-declared rather than pulled from a package: the widget is three methods
 * and a config object, and taking a dependency to describe it would be a worse
 * trade than fifteen lines here.
 */
declare global {
  interface TurnstileOptions {
    sitekey: string;
    theme?: "light" | "dark" | "auto";
    callback?: (token: string) => void;
    "expired-callback"?: () => void;
    "error-callback"?: () => void;
  }

  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: TurnstileOptions) => string | undefined;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export {};
