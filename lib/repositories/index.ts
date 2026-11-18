/**
 * The dashboard's only way to read or change data. Today every function
 * works on browser storage; to move to a backend, re-implement these modules
 * with fetch calls (same names, same types) — nothing in the UI changes.
 */
export * from './clients';
export * from './projects';
export * from './records';
export * from './agreements';
export * from './payments';
export * from './system';
export { DataError, getLoadError, subscribe, getVersion, setStorageAdapter, invalidate } from './db';
