export default function DeleteConfirmModal({ albumId, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-retro-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border-2 border-retro-mint" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-retro-navy mb-2">Delete Album?</h3>
        <p className="text-sm text-retro-teal mb-4">
          The photos inside will not be deleted — only the album is removed.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-retro-cream text-retro-navy text-sm font-semibold hover:bg-retro-mint/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(albumId)}
            className="px-4 py-2 rounded-xl bg-retro-red text-retro-white text-sm font-semibold hover:bg-retro-red/80 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
