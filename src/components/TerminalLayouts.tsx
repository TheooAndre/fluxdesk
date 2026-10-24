import { useEffect, useState } from 'react';
import { useUi } from '../lib/store.ts';
import { readLayouts, writeLayouts, type TerminalLayout } from '../lib/terminal-layouts.ts';

export default function TerminalLayouts() {
  const [layouts, setLayouts] = useState<TerminalLayout[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    try {
      setLayouts(readLayouts(localStorage.getItem('fluxdesk.layouts.v1')));
    } catch {
      setMessage('Saved layouts could not be loaded on this device.');
    }
  }, []);
  function save(next: TerminalLayout[]) {
    try {
      localStorage.setItem('fluxdesk.layouts.v1', writeLayouts(next));
      setLayouts(next);
      setMessage('Layouts saved on this device.');
      return true;
    } catch {
      setMessage('Could not save layouts. Device storage may be unavailable or full.');
      return false;
    }
  }
  function capture() {
    const label = name.trim();
    if (!label || label.length > 40) {
      setMessage('Enter a layout name of 1–40 characters.');
      return;
    }
    if (layouts.length >= 10) {
      setMessage('Remove a layout before saving another (maximum 10).');
      return;
    }
    if (layouts.some((layout) => layout.name.toLowerCase() === label.toLowerCase())) {
      setMessage('Choose a different layout name.');
      return;
    }
    const { assetId, benchmark, tf, category, venue, sort, descending } = useUi.getState();
    if (save([...layouts, { name: label, assetId, benchmark, tf, category, venue, sort, descending }]))
      setName('');
  }
  function apply(layout: TerminalLayout) {
    const ui = useUi.getState();
    ui.setAsset(layout.assetId);
    ui.setBenchmark(layout.benchmark);
    ui.setTf(layout.tf);
    ui.setCategory(layout.category);
    ui.setVenue(layout.venue);
    ui.setSort(layout.sort);
    ui.setDescending(layout.descending);
    setMessage(`Applied ${layout.name}.`);
  }
  return (
    <details className="notice">
      <summary>Saved terminal layouts · {layouts.length}</summary>
      <p className="muted">
        Save market, timeframe, benchmark and table filters on this device. Favorites remain shared across
        devices.
      </p>
      <div className="controls">
        <input
          aria-label="Layout name"
          placeholder="Layout name"
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="secondary" onClick={capture}>
          Save current layout
        </button>
      </div>
      {layouts.map((layout) => (
        <div className="row-between" key={layout.name}>
          <button className="subtle" onClick={() => apply(layout)}>
            {layout.name}
          </button>
          <button
            className="subtle"
            aria-label={`Delete layout ${layout.name}`}
            onClick={() => save(layouts.filter((item) => item.name !== layout.name))}
          >
            Delete
          </button>
        </div>
      ))}
      <p role="status">{message}</p>
    </details>
  );
}
