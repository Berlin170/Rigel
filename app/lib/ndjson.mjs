// A transport chunk is not a record: handle split UTF-8 and a final line
// without a newline, and reject damaged streams rather than hiding them.
export async function readNdjson(body, onMessage) {
  if (!body) throw new Error("The server returned an empty response.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (line) => {
    if (line.trim()) onMessage(JSON.parse(line));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
      if (done) {
        consume(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
