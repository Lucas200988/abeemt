/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Os pacotes do monorepo são TypeScript sem build próprio para o browser.
  transpilePackages: ['@bora/contracts', '@bora/ocpp-core'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
