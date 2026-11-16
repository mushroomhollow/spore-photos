import { useState, useEffect } from 'react';
import { fetchPreferences } from '../api/client';

const GRID_COLS = {
  xs: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8',
  sm: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7',
  md: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  lg: 'grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  xl: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};

export function useGridSize() {
  const [size, setSize] = useState('md');

  useEffect(() => {
    fetchPreferences()
      .then(p => { if (p?.photo_grid_size) setSize(p.photo_grid_size); })
      .catch(() => {});
    const handler = (e) => { if (e.detail?.photo_grid_size) setSize(e.detail.photo_grid_size); };
    window.addEventListener('preference-change', handler);
    return () => window.removeEventListener('preference-change', handler);
  }, []);

  return GRID_COLS[size] || GRID_COLS.md;
}
