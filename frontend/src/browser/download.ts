export function downloadFile(filename: string, blob: Blob): void {
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
