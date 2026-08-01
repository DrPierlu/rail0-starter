import { withEve } from "eve/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

// Mounts the eve agent from ./agent on this app's origin (/eve/v1/*): one dev
// server, one Vercel deploy, and the browser hook finds the routes on its own.
export default withEve(nextConfig);
