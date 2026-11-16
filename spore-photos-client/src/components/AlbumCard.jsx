import { Image, Pencil, Trash2, X, Loader2 } from 'lucide-react';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AlbumCard({ album, onOpen, onEdit, onDelete, onRemove, removeLoading }) {
  return (
    <div
      className="group relative rounded-2xl overflow-hidden border-2 border-retro-mint bg-retro-cream/40 shadow-sm hover:shadow-md transition-all cursor-pointer"
      onClick={onOpen}
    >
      {/* Cover */}
      <div className="aspect-[4/3] bg-retro-mint/20 flex items-center justify-center overflow-hidden">
        {album.cover_url ? (
          <img src={album.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Image size={36} className="text-retro-teal/40" />
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-sm font-bold text-retro-navy truncate">{album.name}</h3>
        <p className="text-xs text-retro-teal mt-0.5">{album.photo_count} photo{album.photo_count !== 1 ? 's' : ''}</p>
        <p className="text-[10px] text-retro-mint mt-0.5">Updated {formatDate(album.updated_at)}</p>
      </div>

      {/* Edit button — only if onEdit provided */}
      {onEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="absolute top-2 right-10 p-1.5 rounded-lg bg-black/30 text-white/70 hover:bg-retro-teal hover:text-white transition-all opacity-0 group-hover:opacity-100"
          title="Edit album"
        >
          <Pencil size={14} />
        </button>
      )}

      {/* Delete button — only if onDelete provided */}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/30 text-white/70 hover:bg-retro-red hover:text-white transition-all opacity-0 group-hover:opacity-100"
          title="Delete album"
        >
          <Trash2 size={14} />
        </button>
      )}

      {/* Remove button — replaces edit/delete for shared album context */}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          disabled={removeLoading}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/30 text-white/70 hover:bg-retro-red hover:text-white transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
          title="Remove from shared albums"
        >
          {removeLoading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
        </button>
      )}
    </div>
  );
}
