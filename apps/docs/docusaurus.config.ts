import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Sivraj Docs',
  tagline: 'Memory, identity, and permissioned AI context.',
  favicon: 'img/favicon.svg',

  url: 'https://docs.sivraj.ai',
  baseUrl: '/',

  organizationName: 'sivraj',
  projectName: 'sivraj',
  trailingSlash: true,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../../docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.svg',
    navbar: {
      title: 'Sivraj Docs',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'mainSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/ddboy19912/sivraj',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Product',
          items: [
            {
              label: 'Get Started',
              to: '/docs/GETTING_STARTED',
            },
            {
              label: 'Roadmap',
              to: '/docs/ROADMAP',
            },
          ],
        },
        {
          title: 'System',
          items: [
            {
              label: 'Architecture',
              to: '/docs/ARCHITECTURE',
            },
            {
              label: 'API Usage',
              to: '/docs/API',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Sivraj.`,
    },
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    prism: {
      theme: require('prism-react-renderer').themes.github,
      darkTheme: require('prism-react-renderer').themes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
