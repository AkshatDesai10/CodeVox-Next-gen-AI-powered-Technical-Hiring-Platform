/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker/self-host uses standalone; Vercel needs the default Next output.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
};

export default nextConfig;
