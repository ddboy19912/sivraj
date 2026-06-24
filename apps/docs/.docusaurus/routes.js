import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/docs/',
    component: ComponentCreator('/docs/', '18c'),
    routes: [
      {
        path: '/docs/',
        component: ComponentCreator('/docs/', '3e4'),
        routes: [
          {
            path: '/docs/',
            component: ComponentCreator('/docs/', '37a'),
            routes: [
              {
                path: '/docs/API/',
                component: ComponentCreator('/docs/API/', 'bae'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/ARCHITECTURE/',
                component: ComponentCreator('/docs/ARCHITECTURE/', 'fbb'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/DEVELOPMENT/',
                component: ComponentCreator('/docs/DEVELOPMENT/', '825'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/GETTING_STARTED/',
                component: ComponentCreator('/docs/GETTING_STARTED/', 'f4b'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/GLOSSARY/',
                component: ComponentCreator('/docs/GLOSSARY/', 'bdf'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/INFRASTRUCTURE/',
                component: ComponentCreator('/docs/INFRASTRUCTURE/', 'b48'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/INTEGRATIONS/',
                component: ComponentCreator('/docs/INTEGRATIONS/', '68f'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/ROADMAP/',
                component: ComponentCreator('/docs/ROADMAP/', 'a92'),
                exact: true,
                sidebar: "mainSidebar"
              },
              {
                path: '/docs/SECURITY/',
                component: ComponentCreator('/docs/SECURITY/', 'aa6'),
                exact: true,
                sidebar: "mainSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/',
    component: ComponentCreator('/', 'e5f'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
