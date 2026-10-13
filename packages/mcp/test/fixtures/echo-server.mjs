/* global process */
// Minimal MCP server over newline-delimited JSON-RPC on stdio, used only as a test fixture.
// Notifications are ignored; `tools/call` echoes its arguments so the transport can be asserted.
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) handle(JSON.parse(line));
    index = buffer.indexOf('\n');
  }
});

process.stderr.write('echo-server siap\n');

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message) {
  if (message.id === undefined) return; // notification

  switch (message.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'echo-server', version: '1.0.0' },
        },
      });
      return;
    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Mengembalikan argumen sebagai teks.',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
            },
            {
              name: 'boom',
              description: 'Gagal sesuai permintaan.',
            },
          ],
        },
      });
      return;
    case 'tools/call': {
      const name = message.params?.name;
      if (name === 'boom') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: 'kegagalan yang dilaporkan server' }], isError: true },
        });
        return;
      }
      if (name === 'hang') {
        return; // never answers, so the client timeout path is exercised
      }
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            { type: 'text', text: `echo:${JSON.stringify(message.params?.arguments ?? {})}` },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
          ],
        },
      });
      return;
    }
    default:
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'metode tidak dikenal' } });
  }
}
