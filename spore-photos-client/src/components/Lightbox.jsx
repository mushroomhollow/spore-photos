import { X, ChevronLeft, ChevronRight, Clock, Download, Maximize2 } from 'lucide-react';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Lightbox({ lightbox, photos, onClose, onPrev, onNext, onDownload }) {
  if (!lightbox) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors z-10">
        <X size={24} />
      </button>

      {photos.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="absolute left-4 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors z-10">
            <ChevronLeft size={28} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="absolute right-4 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors z-10">
            <ChevronRight size={28} />
          </button>
        </>
      )}

      <div className="relative max-w-[90vw] max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
       {lightbox.photo.mime_type?.startsWith('video/') ? (
         <video
           src={lightbox.photo.urls.original}
           controls
           autoPlay
           className="max-w-full max-h-[85vh] rounded-lg"
           style={{ maxHeight: '85vh' }}
         >
           Your browser does not support video playback.
         </video>
       ) : (
         <img
           src={lightbox.photo.mime_type === 'image/gif' ? lightbox.photo.urls.original : lightbox.photo.urls.preview}
           alt={lightbox.photo.original_filename}
           className="max-w-full max-h-[85vh] object-contain rounded-lg"
         />
       )}

       {/* Full-size button — opens the ORIGINAL file in a new tab so the browser's
           own image/video viewer drives zoom and pan natively, instead of being
           constrained by this modal's max-w-[90vw] / max-h-[85vh] preview.
           Keep it inside the media box (relative parent) so it sits on the
           bottom-right corner of the photo, not of the viewport. */}
       <a
         href={lightbox.photo.urls.original}
         target="_blank"
         rel="noopener noreferrer"
         onClick={(e) => e.stopPropagation()}
         title="Open full size"
         aria-label="Open full size in a new tab"
         className="absolute bottom-3 right-3 z-10 p-2.5 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
       >
         <Maximize2 size={20} />
       </a>
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-4">
        <div className="flex items-center justify-between text-white text-sm">
          <div className="flex items-center gap-4">
            <span className="font-semibold">{lightbox.photo.original_filename}</span>
            <span className="text-white/60 flex items-center gap-1"><Clock size={14} /> {formatDate(lightbox.photo.date_taken || lightbox.photo.created_at)}</span>
            <span className="text-white/60">{formatSize(lightbox.photo.file_size)}</span>
            {lightbox.photo.width && <span className="text-white/60">{lightbox.photo.width}×{lightbox.photo.height}</span>}
          </div>
          <button onClick={(e) => { e.stopPropagation(); onDownload?.(lightbox.photo); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors text-sm">
            <Download size={14} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}
