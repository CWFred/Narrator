import React, { useState } from "react";

export interface TourFileInfo {
  path: string;
  why: string;
  status: "current" | "explored" | "unexplored";
}

interface TourNavigatorProps {
  files: TourFileInfo[];
  onJumpToFile: (path: string) => void;
  onEndTour: () => void;
}

export function TourNavigator({ files, onJumpToFile, onEndTour }: TourNavigatorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const exploredCount = files.filter((f) => f.status === "explored" || f.status === "current").length;

  if (collapsed) {
    return (
      <div className="tour-navigator collapsed" onClick={() => setCollapsed(false)}>
        <span className="tour-summary">
          Tour: {exploredCount}/{files.length} files explored
        </span>
        <span className="tour-expand-hint">Click to expand</span>
      </div>
    );
  }

  const currentIdx = files.findIndex((f) => f.status === "current");
  const nextIdx = currentIdx + 1 < files.length ? currentIdx + 1 : -1;
  const nextFile = nextIdx >= 0 ? files[nextIdx] : null;

  return (
    <div className="tour-navigator">
      <div className="tour-header">
        <span className="tour-summary" onClick={() => setCollapsed(true)}>
          Tour: {exploredCount}/{files.length} files explored
        </span>
        <div className="tour-header-buttons">
          {nextFile && (
            <button className="tour-next-btn" onClick={() => onJumpToFile(nextFile.path)}>
              Next
            </button>
          )}
          <button className="tour-end-btn" onClick={onEndTour}>End Tour</button>
        </div>
      </div>
      <div className="tour-file-list">
        {files.map((file) => (
          <div
            key={file.path}
            className={`tour-file-item tour-file-${file.status}`}
            onClick={() => onJumpToFile(file.path)}
          >
            <span className="tour-file-status">
              {file.status === "explored" ? "\u2713" : file.status === "current" ? "\u25B6" : "\u25CB"}
            </span>
            <div className="tour-file-info">
              <span className="tour-file-path">{file.path}</span>
              {file.why && <span className="tour-file-why">{file.why}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
