import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export function RecordDialog({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  error?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="record-overlay" />
        <Dialog.Content className="record-dialog" aria-describedby={undefined}>
          <div className="section-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={17} />
            </Dialog.Close>
          </div>
          <div className="modal-body">
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
