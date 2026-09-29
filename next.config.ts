import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Next's dev server only serves dev resources (the HMR socket, the client
   * bundle) to `localhost` by default. Opening the app on `127.0.0.1` in
   * development therefore leaves the page server-rendered but never
   * hydrated, which is a confusing failure: everything looks right and no
   * interactive element works.
   *
   * Development only — it has no effect on a production build.
   */
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
