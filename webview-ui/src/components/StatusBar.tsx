import React from "react";

interface StatusBarProps {
  status: "idle" | "loading" | "streaming" | "playing" | "error";
  error?: string;
}

export function StatusBar({ status, error }: StatusBarProps) {
  if (status === "idle") return null;

  return (
    <div className={`status-bar status-${status}`}>
      {status === "loading" && (
        <>
          <span className="loading-dots">
            <span />
            <span />
            <span />
          </span>
          <span>Generating explanation...</span>
        </>
      )}
      {status === "streaming" && (
        <>
          <span className="loading-dots">
            <span />
            <span />
            <span />
          </span>
          <span>Receiving explanation...</span>
        </>
      )}
      {status === "playing" && null}
      {status === "error" && (
        <div className="error-detail">
          <strong>Error</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
