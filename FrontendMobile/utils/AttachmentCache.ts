// Shared E2EE decrypted attachment memory pointers to optimize JS heap garbage collection
export const globalAttachmentCache: { [url: string]: string } = {};

export const clearGlobalAttachmentCache = () => {
  Object.keys(globalAttachmentCache).forEach(k => delete globalAttachmentCache[k]);
};
