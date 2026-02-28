import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Murmur',
  description: 'An Ollama-like TTS server — pull models, run locally, serve via API',
  base: '/murmur/',

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/murmur/favicon.svg' }]],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/' },
      { text: 'Models', link: '/models/' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'CLI Reference', link: '/guide/cli' },
          { text: 'Docker & Deployment', link: '/guide/docker' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/api/' },
          { text: 'Generate Speech', link: '/api/generate' },
          { text: 'Models', link: '/api/models' },
          { text: 'Health & Version', link: '/api/health' },
        ],
      },
      {
        text: 'Resources',
        items: [
          { text: 'Available Models', link: '/models/' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Development', link: '/development' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/KevinBonnoron/murmur' }],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/KevinBonnoron/murmur/edit/main/docs/:path',
    },

    footer: {
      message: 'Released under the MIT License.',
    },
  },
});
