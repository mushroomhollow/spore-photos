import { useState, useEffect } from 'react';
import { Grid3X3, Check } from 'lucide-react';
import { fetchPreferences, updatePreferences } from '../api/client';

const GRID_SIZES = [
  { value: 'xs', label: 'X-Small', cols: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8' },
  { value: 'sm', label: 'Small',   cols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7' },
  { value: 'md', label: 'Medium',  cols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' },
  { value: 'lg', label: 'Large',   cols: 'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' },
  { value: 'xl', label: 'X-Large', cols: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' },
];

export default function PreferencesPanel() {
  const [gridSize, setGridSize] = useState('md');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const prefs = await fetchPreferences();
        if (prefs?.photo_grid_size) setGridSize(prefs.photo_grid_size);
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleChange = async (value) => {
    setGridSize(value);
    setSaving(true);
    setSaved(false);
    try {
      await updatePreferences({ photo_grid_size: value });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Broadcast to other tabs/components via a custom event
      window.dispatchEvent(new CustomEvent('preference-change', { detail: { photo_grid_size: value } }));
    } catch {} finally {
      setSaving(false);
    }
  };

  const idx = GRID_SIZES.findIndex(s => s.value === gridSize);
  const pct = idx >= 0 ? ((idx) / (GRID_SIZES.length - 1)) * 100 : 50;

  if (loading) {
    return <div className="p-6 text-retro-teal text-sm">Loading preferences...</div>;
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h3 className="text-lg font-bold text-retro-navy flex items-center gap-2 mb-1">
          <Grid3X3 size={20} className="text-retro-teal" />
          Photo Grid Size
        </h3>
        <p className="text-sm text-retro-teal mb-6">
          Adjust how many photos appear per row in the gallery and album views.
        </p>

        {/* Slider */}
        <div className="max-w-md">
          <input
            type="range"
            min="0"
            max="4"
            step="1"
            value={idx}
            onChange={(e) => handleChange(GRID_SIZES[parseInt(e.target.value)].value)}
            className="w-full h-2 bg-retro-mint/40 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-retro-teal
              [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-retro-teal [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"
          />

          {/* Labels */}
          <div className="flex justify-between text-xs text-retro-teal mt-2 px-0.5">
            {GRID_SIZES.map(s => (
              <span key={s.value} className={`${s.value === gridSize ? 'text-retro-navy font-bold' : ''}`}>
                {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="mt-6">
          <p className="text-xs text-retro-teal mb-2">Preview:</p>
          <div className={`grid gap-2 ${GRID_SIZES.find(s => s.value === gridSize)?.cols || 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'}`}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-retro-mint/30 border border-retro-mint/50 flex items-center justify-center">
                <Grid3X3 size={14} className="text-retro-teal/40" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
