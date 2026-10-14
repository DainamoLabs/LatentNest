/** A key combination such as "Alt+Q" as separate keys. macOS gives symbols ("⌥Q"), shown as one. */
export function Keys({ value }: { value: string }) {
  const parts = value.length > 1 && value.includes('+') ? value.split('+') : [value];
  return (
    <span className="keys">
      {parts.map((key, i) => (
        <kbd key={i}>{key}</kbd>
      ))}
    </span>
  );
}
