import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const primaryLinks = [
  {
    label: 'Get Started',
    description: 'Run Sivraj locally and understand the first product path.',
    to: '/docs/GETTING_STARTED',
  },
  {
    label: 'API Usage',
    description: 'Request scoped context from a Twin with permission-aware flows.',
    to: '/docs/API',
  },
  {
    label: 'Infrastructure',
    description: 'Understand the apps, services, storage, and processing flow.',
    to: '/docs/INFRASTRUCTURE',
  },
  {
    label: 'Integrations',
    description: 'Connect external tools without exposing unrestricted memory.',
    to: '/docs/INTEGRATIONS',
  },
];

export default function Home() {
  return (
    <Layout
      title="Sivraj Docs"
      description="Technical documentation for Sivraj memory, identity, and permissioned AI context."
    >
      <main className={styles.page}>
        <section className={styles.intro}>
          <p className={styles.kicker}>Sivraj documentation</p>
          <h1>Memory-first AI workspace docs.</h1>
          <p className={styles.summary}>
            Product, architecture, security, operations, and implementation notes for the Sivraj
            monorepo.
          </p>
        </section>

        <section className={styles.linkGrid} aria-label="Primary documentation links">
          {primaryLinks.map((item) => (
            <Link className={styles.docLink} key={item.to} to={item.to}>
              <span>{item.label}</span>
              <small>{item.description}</small>
            </Link>
          ))}
        </section>
      </main>
    </Layout>
  );
}
