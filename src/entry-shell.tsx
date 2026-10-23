import React from 'react';
import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';

/** Build-only UI: queries remain disabled until the browser mounts App. */
export function renderShell(): Promise<string> {
  const query = new QueryClient();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let failed = false;
    let abort = () => {};
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      query.clear();
      abort();
      reject(error);
    };
    const timer = setTimeout(() => fail(Error('Static shell rendering timed out')), 10_000);
    const sink = new Writable({
      write(chunk, _encoding, next) {
        chunks.push(Buffer.from(chunk));
        next();
      },
    });
    sink.on('error', fail);
    sink.on('finish', () => {
      clearTimeout(timer);
      query.clear();
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    const stream = renderToPipeableStream(
      <React.StrictMode>
        <QueryClientProvider client={query}>
          <App />
        </QueryClientProvider>
      </React.StrictMode>,
      {
        onAllReady() {
          if (!failed) stream.pipe(sink);
        },
        onError: fail,
        onShellError: fail,
      },
    );
    abort = stream.abort;
  });
}
