import styles from './loading-spinner.module.css';

/** Decorative indicator; the surrounding status supplies the accessible label. */
export function LoadingSpinner(){
  return <span className={styles.spinner} aria-hidden="true" data-loading-spinner/>;
}
