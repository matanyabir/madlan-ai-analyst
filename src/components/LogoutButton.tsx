"use client";

/**
 * Signing out, like signing in, changes server-rendered state on every
 * route, so it takes a real page load rather than a soft navigation that
 * could be served from the client router cache.
 */
export function LogoutButton() {
  return (
    <button
      type="button"
      data-testid="logout"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft navigation can serve a cached signed-in page after sign-out.
        window.location.assign("/");
      }}
      className="text-muted hover:underline"
    >
      התנתקות
    </button>
  );
}
