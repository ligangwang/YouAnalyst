import { LocalizedLink as Link } from './localized-link';
import { UiText } from './ui-text';
import styles from './intelligence-live.module.css';

/** Small server-rendered response while the data and interactive map load. */
export function IntelligenceLoadingShell() {
  return <main className={styles.loadingShell} aria-busy="true">
    <h1><UiText text="Investment Intelligence"/></h1>
    <p role="status"><UiText text="Loading companies and recorded events…"/></p>
    <nav aria-label="Research navigation">
      <Link href="/companies" prefetch={false}><UiText text="Companies"/></Link>{' · '}
      <Link href="/research" prefetch={false}><UiText text="Research"/></Link>
    </nav>
  </main>;
}
