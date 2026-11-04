self.onmessage = async (event: MessageEvent<{ id: number; payload: Uint8Array<ArrayBuffer> }>) => {
  const { id, payload } = event.data;
  const digest = await crypto.subtle.digest("SHA-256", payload);
  self.postMessage({
    id,
    hash: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
    length: payload.byteLength,
  });
};
