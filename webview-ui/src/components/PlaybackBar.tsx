import React from "react";

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface PlaybackBarProps {
  isPlaying: boolean;
  hasAudio: boolean;
  playbackRate: number;
  onPlay: () => void;
  onStop: () => void;
  onSetPlaybackRate: (rate: number) => void;
}

export function PlaybackBar({
  isPlaying,
  hasAudio,
  playbackRate,
  onPlay,
  onStop,
  onSetPlaybackRate,
}: PlaybackBarProps) {
  return (
    <div className="playback-bar">
      <div className="playback-controls">
        {isPlaying ? (
          <button onClick={onStop}>Stop</button>
        ) : (
          <button className="play-btn" onClick={onPlay} disabled={!hasAudio}>
            Play All
          </button>
        )}
        <div className="speed-control">
          {SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              className={`speed-btn ${playbackRate === speed ? "active" : ""}`}
              onClick={() => onSetPlaybackRate(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
