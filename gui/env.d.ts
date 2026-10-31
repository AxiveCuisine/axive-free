declare module '*.css'
declare namespace React {
  interface HTMLAttributes<T> {
    'aria-description'?: string
  }
}
/** 'axive' or 'free': set by scripts/build-gui.mjs from the package name */
declare const __AXIVE_EDITION__: string
