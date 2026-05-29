/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['picsum.photos', 'replicate.delivery', 'scontent.cdninstagram.com'],
  },
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const baseUrl = backendUrl.replace(/\/api\/v1\/?$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${baseUrl}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${baseUrl}/uploads/:path*`,
      },
    ]
  },
  output: 'standalone',
}

module.exports = nextConfig
