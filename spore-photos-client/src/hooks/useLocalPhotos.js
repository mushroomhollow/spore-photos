import { useEffect, useState } from 'react';
import * as store from '../backup/localStore';

/**
 * Subscribe a component to the local-phone-photos store.
 * Returns the store state plus its actions. Safe in the browser (empty list).
 */
export function useLocalPhotos() {
  const [state, setState] = useState(() => {
    store.init();
    return store.getState();
  });

  useEffect(() => {
    // store.subscribe invokes the callback immediately and returns an unsubscribe.
    const unsubscribe = store.subscribe(setState);
    return unsubscribe;
  }, []);

  return {
    ...state,
    setEnabled: store.setEnabled,
    uploadOne: store.uploadOne,
    refresh: store.refresh,
    runAutoBackup: store.runAutoBackup,
  };
}

export default useLocalPhotos;
