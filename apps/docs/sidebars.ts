import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  mainSidebar: [
    {
      type: 'category',
      label: 'Start Here',
      collapsed: false,
      items: ['GETTING_STARTED', 'ROADMAP'],
    },
    {
      type: 'category',
      label: 'Build With Sivraj',
      collapsed: false,
      items: ['API', 'INTEGRATIONS'],
    },
    {
      type: 'category',
      label: 'Platform',
      collapsed: false,
      items: ['ARCHITECTURE', 'INFRASTRUCTURE', 'SECURITY', 'DEVELOPMENT', 'GLOSSARY'],
    },
  ],
};

export default sidebars;
