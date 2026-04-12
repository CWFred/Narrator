import React, { useEffect, useRef } from "react";
import { SegmentNode, isExpandable } from "../types";

interface TranscriptProps {
  tree: SegmentNode[];
  activeSegmentId: string | null;
  streamingText: string;
  onSegmentPlay: (id: string) => void;
  onSegmentExpand: (id: string) => void;
}

function SegmentNodeView({
  node,
  depth,
  activeSegmentId,
  onSegmentPlay,
  onSegmentExpand,
}: {
  node: SegmentNode;
  depth: number;
  activeSegmentId: string | null;
  onSegmentPlay: (id: string) => void;
  onSegmentExpand: (id: string) => void;
}) {
  const isActive = node.id === activeSegmentId;
  const ref = useRef<HTMLDivElement>(null);
  const expandable = isExpandable(node);

  useEffect(() => {
    if (isActive) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isActive]);

  return (
    <div className="segment-tree-node" style={{ paddingLeft: depth * 16 }}>
      <div
        ref={ref}
        className={`segment-row ${isActive ? "active" : ""}`}
      >
        {expandable ? (
          <button
            className="segment-expand-btn"
            onClick={(e) => { e.stopPropagation(); onSegmentExpand(node.id); }}
            aria-label={node.isExpanded ? "Collapse" : "Expand"}
          >
            {node.isLoading ? (
              <span className="segment-spinner" />
            ) : node.isExpanded ? (
              <span className="segment-arrow expanded" />
            ) : (
              <span className="segment-arrow" />
            )}
          </button>
        ) : (
          <span className="segment-arrow-spacer" />
        )}
        <span
          className="segment-text"
          onClick={() => onSegmentPlay(node.id)}
        >
          {node.narration}
        </span>
      </div>
      {node.isExpanded && node.children && (
        <div className="segment-children">
          {node.children.map((child) => (
            <SegmentNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              activeSegmentId={activeSegmentId}
              onSegmentPlay={onSegmentPlay}
              onSegmentExpand={onSegmentExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Transcript({
  tree,
  activeSegmentId,
  streamingText,
  onSegmentPlay,
  onSegmentExpand,
}: TranscriptProps) {
  return (
    <div className="transcript">
      <h3>Transcript</h3>
      {tree.map((node) => (
        <SegmentNodeView
          key={node.id}
          node={node}
          depth={0}
          activeSegmentId={activeSegmentId}
          onSegmentPlay={onSegmentPlay}
          onSegmentExpand={onSegmentExpand}
        />
      ))}
      {streamingText && (
        <div className="transcript-segment streaming">{streamingText}</div>
      )}
      {tree.length === 0 && !streamingText && (
        <div className="transcript-empty">
          Select code and press Ctrl+Shift+N to start.
        </div>
      )}
    </div>
  );
}
