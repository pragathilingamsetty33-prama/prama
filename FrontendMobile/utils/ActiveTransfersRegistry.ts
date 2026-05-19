// Shared E2EE active transfers registry to prevent premature cleanup of running downloads/uploads
const activeTransfers = new Set<string>();

export function registerActiveTransfer(filePathOrName: string) {
  activeTransfers.add(filePathOrName);
}

export function deregisterActiveTransfer(filePathOrName: string) {
  activeTransfers.delete(filePathOrName);
}

export function isTransferActive(filePathOrName: string): boolean {
  return activeTransfers.has(filePathOrName);
}
