import styles from "./atlas.module.css";

const AtlasEmptyState = ({ title, message }: Readonly<{ title: string; message: string }>) => (
  <div className={styles.emptyState}>
    <div>
      <div className={styles.brandTitle}>{title}</div>
      <p className={styles.contextCopy}>{message}</p>
    </div>
  </div>
);

const AtlasLoadingState = () => (
  <div className={styles.inspector} aria-busy="true">
    <div className={styles.inspectorHeader}>
      <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
      <div className="mt-4 h-9 w-64 animate-pulse rounded bg-white/10" />
    </div>
    <div className={styles.inspectorBody}>
      <div className="h-32 animate-pulse rounded-2xl bg-white/[0.05]" />
    </div>
  </div>
);

export { AtlasEmptyState, AtlasLoadingState };
