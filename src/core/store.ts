import {useSyncExternalStore} from 'react'

export type Store<T> = {
  get: () => T
  set: (next: T | ((previous: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

/** A tiny observable value. React reads it through useStore; plain code calls get/set. */
export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Subscribe a component to a store. The selector must return something stable
 * (a primitive, or a reference held in the store) — a fresh object every call
 * would re-render forever.
 */
export function useStore<T, S = T>(store: Store<T>, selector: (state: T) => S = state => state as unknown as S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()))
}
