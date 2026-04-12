import React from "react";

type Depth = "overview" | "standard" | "deep";

interface DepthPickerProps {
  value: Depth;
  onChange: (depth: Depth) => void;
  disabled?: boolean;
}

const labels: Record<Depth, string> = {
  overview: "Overview",
  standard: "Standard",
  deep: "Deep Dive",
};

export function DepthPicker({ value, onChange, disabled }: DepthPickerProps) {
  return (
    <div className="depth-picker">
      <label>Depth:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Depth)}
        disabled={disabled}
      >
        {(Object.keys(labels) as Depth[]).map((d) => (
          <option key={d} value={d}>
            {labels[d]}
          </option>
        ))}
      </select>
    </div>
  );
}
