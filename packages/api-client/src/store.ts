import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { bitocardApi } from './base';

/** A Redux store holding the API cache. Create one per browser tab (in a client provider), never per server request. */
export function makeStore() {
  const store = configureStore({
    reducer: { [bitocardApi.reducerPath]: bitocardApi.reducer },
    middleware: getDefault => getDefault().concat(bitocardApi.middleware),
  });
  // Refetch when the tab regains focus or the connection returns.
  setupListeners(store.dispatch);
  return store;
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
