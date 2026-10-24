import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
/** Preserve incomplete numeric edits (0., -, blank) while the model receives numbers.
 * External record/reload changes still replace the displayed value.
 */
export default function JournalNumberInput({
  value,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> & { value: string | number }) {
  const [text, setText] = useState(String(value));
  const lastValue = useRef(value),
    edited = useRef(false);
  useEffect(() => {
    if (edited.current) {
      edited.current = false;
      lastValue.current = value;
      return;
    }
    if (value !== lastValue.current) {
      lastValue.current = value;
      setText(String(value));
    }
  });
  return (
    <input
      {...props}
      type="number"
      value={text}
      onChange={(event) => {
        edited.current = true;
        setText(event.target.value);
        onChange?.(event);
      }}
    />
  );
}
