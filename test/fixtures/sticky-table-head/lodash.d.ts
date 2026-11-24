/**
 * `lodash` is loaded with @require at runtime, so it is not a dependency of this
 * package. Scripts that use it still need types: either install `@types/lodash`,
 * or keep a small stub like this one next to the script.
 */
declare module 'lodash' {
  interface ThrottleOptions {
    leading?: boolean
    trailing?: boolean
  }

  interface Lodash {
    throttle<F extends (...args: never[]) => unknown>(fn: F, wait?: number, options?: ThrottleOptions): F
    debounce<F extends (...args: never[]) => unknown>(fn: F, wait?: number, options?: ThrottleOptions): F
    map<T, R>(collection: T[], iteratee: (value: T, index: number) => R): R[]
  }

  const lodash: Lodash
  export default lodash
}
