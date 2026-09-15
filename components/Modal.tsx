"use client";

export default function Modal({
  title,
  onClose,
  children,
  width = "w-[480px]",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center pt-16 md:pt-24 bg-ink/20 px-4"
      onClick={onClose}
    >
      <div
        className={`${width} max-w-full max-h-[85vh] flex flex-col rounded-md border border-line bg-surface shadow-lg p-4 md:p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-xs text-muted hover:text-ink">
            Close
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
