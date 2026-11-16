import { X, Download, Trash2, Share2, FolderOpen } from 'lucide-react';

export default function SelectionToolbar({
  selCount,
  // Actions
  onDelete,
  onShare,
  onAlbum,
  onClearSelection,
  // Loading states
  deleting,
  // Download
  onDownloadSingle,
  multiDownloadParam,
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-retro-navy rounded-xl shadow-md">
      <span className="text-retro-cream font-semibold text-sm">
        {selCount} selected
      </span>
      <div className="flex items-center gap-2">
        {/* Delete */}
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-retro-red text-retro-white text-sm font-semibold hover:bg-retro-red/80 transition-colors disabled:opacity-50"
          >
            <Trash2 size={15} />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        )}

        {/* Share */}
        {onShare && (
          <button
            onClick={onShare}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-retro-teal text-retro-cream hover:bg-retro-teal/80 transition-colors text-sm font-semibold"
            title="Share selected photos"
          >
            <Share2 size={15} />
            Share
          </button>
        )}

        {/* Album */}
        {onAlbum && (
          <button
            onClick={onAlbum}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-teal/80 transition-colors text-sm font-semibold border border-retro-teal/30"
            title="Manage albums"
          >
            <FolderOpen size={15} />
            Album
          </button>
        )}

        {/* Download */}
        {selCount === 1 && onDownloadSingle ? (
          <button
            onClick={onDownloadSingle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-navy/80 transition-colors text-sm font-semibold"
            title="Download photo"
          >
            <Download size={15} />
            Download
          </button>
        ) : multiDownloadParam ? (
          <a
            href={`/api/photos/download-zip?ids=${multiDownloadParam}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-navy/80 transition-colors text-sm font-semibold"
            title="Download all selected as zip"
          >
            <Download size={15} />
            Download All
          </a>
        ) : null}

        {/* Close */}
        <button
          onClick={onClearSelection}
          className="p-1.5 rounded-lg text-retro-cream/60 hover:text-retro-cream hover:bg-retro-teal/20 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
