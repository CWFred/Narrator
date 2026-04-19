import React, { useState, useEffect, useCallback } from "react";
import { useVsCode } from "./hooks/useVsCode";
import { useAudio } from "./hooks/useAudio";
import { Transcript } from "./components/Transcript";
import { PlaybackBar } from "./components/PlaybackBar";
import { FollowUp } from "./components/FollowUp";
import { StatusBar } from "./components/StatusBar";
import { TourNavigator, TourFileInfo } from "./components/TourNavigator";
import {
  SegmentNode,
  segmentsToNodes,
  findNodeById,
  updateNodeById,
} from "./types";

type Status = "idle" | "loading" | "streaming" | "playing" | "error";

interface CodeInfo {
  code: string;
  language: string;
  fileName: string;
  startLine: number;
  endLine: number;
}

export default function App() {
  const vscode = useVsCode();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [segmentTree, setSegmentTree] = useState<SegmentNode[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [codeInfo, setCodeInfo] = useState<CodeInfo | null>(null);
  const [tourFiles, setTourFiles] = useState<TourFileInfo[]>([]);
  const [tourActive, setTourActive] = useState(false);
  const [tourProgress, setTourProgress] = useState<string | null>(null);
  const [autoGenAudio, setAutoGenAudio] = useState(true);
  const [generatingSegmentId, setGeneratingSegmentId] = useState<string | null>(null);
  const [expandedScope, setExpandedScope] = useState<{
    startLine: number;
    endLine: number;
    parentNarration: string;
  } | null>(null);

  const handleSegmentStart = useCallback(
    (segmentId: string) => {
      const node = findNodeById(segmentTree, segmentId);
      if (node && node.highlight_range.start > 0) {
        vscode.postMessage({
          type: "segmentStarted",
          payload: {
            segmentId,
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
          },
        });
      }
    },
    [segmentTree, vscode]
  );

  const handleSegmentEnd = useCallback(
    (segmentId: string) => {
      vscode.postMessage({
        type: "segmentEnded",
        payload: { segmentId },
      });
    },
    [vscode]
  );

  const audio = useAudio(handleSegmentStart, handleSegmentEnd);

  const handlePlay = useCallback(() => {
    audio.play();
  }, [audio]);

  const handleStop = useCallback(() => {
    audio.stop();
    vscode.postMessage({ type: "playbackStopped" });
  }, [audio, vscode]);

  const handleSegmentPlay = useCallback(
    async (segmentId: string) => {
      const node = findNodeById(segmentTree, segmentId);
      if (!node) return;

      audio.stop();
      audio.reset();

      if (node.highlight_range.start > 0) {
        vscode.postMessage({
          type: "segmentStarted",
          payload: {
            segmentId,
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
          },
        });
      }

      const played = await audio.playCached(segmentId, node.narration);
      if (!played) {
        audio.play();
        vscode.postMessage({
          type: "narrateSegment",
          payload: { segmentId, text: node.narration },
        });
      }
    },
    [segmentTree, vscode, audio]
  );

  const handleSegmentExpand = useCallback(
    (segmentId: string) => {
      const node = findNodeById(segmentTree, segmentId);
      if (!node) return;

      if (node.children) {
        setSegmentTree((prev) =>
          updateNodeById(prev, segmentId, (n) => ({
            ...n,
            isExpanded: !n.isExpanded,
          }))
        );
        if (!node.isExpanded) {
          setExpandedScope({
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
            parentNarration: node.narration,
          });
        } else {
          setExpandedScope(null);
        }
      } else {
        setSegmentTree((prev) =>
          updateNodeById(prev, segmentId, (n) => ({ ...n, isLoading: true }))
        );
        setExpandedScope({
          startLine: node.highlight_range.start,
          endLine: node.highlight_range.end,
          parentNarration: node.narration,
        });
        vscode.postMessage({
          type: "drillDown",
          payload: {
            segmentId,
            startLine: node.highlight_range.start,
            endLine: node.highlight_range.end,
            parentNarration: node.narration,
          },
        });
      }
    },
    [segmentTree, vscode]
  );

  const handleFollowUp = useCallback(
    (question: string) => {
      vscode.postMessage({
        type: "followUp",
        payload: {
          question,
          scopeStartLine: expandedScope?.startLine,
          scopeEndLine: expandedScope?.endLine,
          parentNarration: expandedScope?.parentNarration,
        },
      });
      setStatus("loading");
      setStreamingText("");
    },
    [vscode, expandedScope]
  );

  const handleStartOver = useCallback(() => {
    audio.stop();
    setSegmentTree([]);
    setStreamingText("");
    setTourFiles([]);
    setTourActive(false);
    setTourProgress(null);
    setExpandedScope(null);
    setStatus("idle");
    setError(undefined);
    vscode.postMessage({ type: "startOver" });
  }, [audio, vscode]);

  const handleTourJumpToFile = useCallback(
    (path: string) => {
      audio.stop();
      setSegmentTree([]);
      setStreamingText("");
      setStatus("loading");
      vscode.postMessage({
        type: "tourJumpToFile",
        payload: { path },
      });
    },
    [audio, vscode]
  );

  const handleEndTour = useCallback(() => {
    audio.stop();
    setTourFiles([]);
    setTourActive(false);
    setTourProgress(null);
    setSegmentTree([]);
    setStreamingText("");
    setStatus("idle");
    setCodeInfo(null);
  }, [audio]);

  const handleDepthSelect = useCallback(
    (depth: "overview" | "standard" | "deep") => {
      setStatus("loading");
      setStreamingText("");
      setSegmentTree([]);
      audio.reset();
      if (!codeInfo) {
        setTourProgress("Starting analysis...");
        vscode.postMessage({
          type: "requestRepoTour",
          payload: { depth },
        });
      } else {
        vscode.postMessage({
          type: "requestExplanation",
          payload: { depth },
        });
      }
    },
    [vscode, audio, codeInfo]
  );

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "codeContext":
          setCodeInfo(message.payload);
          setSegmentTree([]);
          setStreamingText("");
          setExpandedScope(null);
          setStatus("idle");
          setError(undefined);
          audio.reset();
          setGeneratingSegmentId(null);
          setTourProgress(null);
          break;
        case "explanationChunk":
          setStatus("streaming");
          setStreamingText((prev) => prev + message.payload.text);
          break;
        case "explanationComplete": {
          const nodes = segmentsToNodes(message.payload.segments);
          setSegmentTree(nodes);
          setStreamingText("");
          setStatus("playing");
          // Auto-generate audio for all segments in parallel
          if (autoGenAudio) {
            vscode.postMessage({
              type: "startAudioGeneration",
              payload: {
                segments: nodes.map((n) => ({ segmentId: n.id, text: n.narration })),
              },
            });
          }
          break;
        }
        case "ttsStarted":
          setGeneratingSegmentId(message.payload.segmentId);
          break;
        case "audioData":
          audio.enqueue({
            segmentId: message.payload.segmentId,
            narrationText: message.payload.narrationText,
            audioBase64: message.payload.audioBase64,
            mimeType: message.payload.mimeType,
          });
          setGeneratingSegmentId(null);
          break;
        case "drillDownComplete": {
          const children = segmentsToNodes(message.payload.children);
          setSegmentTree((prev) =>
            updateNodeById(prev, message.payload.segmentId, (n) => ({
              ...n,
              children,
              isExpanded: true,
              isLoading: false,
            }))
          );
          if (autoGenAudio) {
            vscode.postMessage({
              type: "startAudioGeneration",
              payload: {
                segments: children.map((n) => ({ segmentId: n.id, text: n.narration })),
              },
            });
          }
          break;
        }
        case "tourProgress":
          setTourProgress(message.payload.phase);
          break;
        case "tourFiles": {
          const files: TourFileInfo[] = message.payload.files.map((f: { path: string; why: string }) => ({
            path: f.path,
            why: f.why,
            status: "unexplored" as const,
          }));
          setTourFiles(files);
          setTourActive(true);
          setTourProgress(null);
          break;
        }
        case "tourFileStarted": {
          setTourFiles((prev) =>
            prev.map((f) => ({
              ...f,
              status: f.path === message.payload.path
                ? "current"
                : f.status === "current"
                  ? "explored"
                  : f.status,
            }))
          );
          break;
        }
        case "error":
          setStatus("error");
          setError(message.payload.message);
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [audio]);

  // Keyboard shortcuts for speed control: [ decreases, ] increases
  useEffect(() => {
    const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "[" || e.key === "]") {
        const currentIndex = SPEED_OPTIONS.indexOf(audio.playbackRate);
        const idx = currentIndex === -1 ? 2 : currentIndex; // default to 1x
        if (e.key === "[" && idx > 0) {
          audio.setPlaybackRate(SPEED_OPTIONS[idx - 1]);
        } else if (e.key === "]" && idx < SPEED_OPTIONS.length - 1) {
          audio.setPlaybackRate(SPEED_OPTIONS[idx + 1]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [audio.playbackRate, audio.setPlaybackRate]);

  const isBusy = status === "loading" || status === "streaming";

  const followUpPlaceholder = expandedScope
    ? `Ask about lines ${expandedScope.startLine}–${expandedScope.endLine}...`
    : "Ask a follow-up...";

  return (
    <div className="narrator-app">
      <header className="narrator-header">
        <h2>NARRATOR</h2>
        <label className="auto-audio-toggle">
          <input
            type="checkbox"
            checked={autoGenAudio}
            onChange={(e) => setAutoGenAudio(e.target.checked)}
          />
          Auto-audio
        </label>
      </header>

      {codeInfo && (
        <div className="code-info">
          <span className="code-info-file">{codeInfo.fileName}</span>
          <span className="code-info-lines">
            L{codeInfo.startLine}–{codeInfo.endLine}
          </span>
          <span className="code-info-lang">{codeInfo.language}</span>
        </div>
      )}

      <StatusBar status={status} error={error} />

      <PlaybackBar
        isPlaying={audio.isPlaying}
        isPaused={audio.isPaused}
        hasAudio={audio.hasAudio}
        playbackRate={audio.playbackRate}
        onPlay={handlePlay}
        onPause={audio.pause}
        onResume={audio.resume}
        onSkip={audio.skip}
        onStop={handleStop}
        onSetPlaybackRate={audio.setPlaybackRate}
      />

      <div className="transcript-area">
        {status === "idle" && (codeInfo || (!tourActive && !tourProgress)) ? (
          <div className="depth-cards">
            <button className="depth-card" onClick={() => handleDepthSelect("overview")}>
              <span className="depth-card-title">Overview</span>
              <span className="depth-card-desc">30–60s quick summary</span>
            </button>
            <button className="depth-card" onClick={() => handleDepthSelect("standard")}>
              <span className="depth-card-title">Standard</span>
              <span className="depth-card-desc">1–2 min walkthrough</span>
            </button>
            <button className="depth-card" onClick={() => handleDepthSelect("deep")}>
              <span className="depth-card-title">Deep Dive</span>
              <span className="depth-card-desc">2–5 min detailed</span>
            </button>
          </div>
        ) : (
          <Transcript
            tree={segmentTree}
            activeSegmentId={audio.currentSegmentId}
            generatingSegmentId={generatingSegmentId}
            streamingText={streamingText}
            onSegmentPlay={handleSegmentPlay}
            onSegmentExpand={handleSegmentExpand}
          />
        )}
      </div>

      {tourActive && tourFiles.length > 0 && (
        <TourNavigator
          files={tourFiles}
          onJumpToFile={handleTourJumpToFile}
          onEndTour={handleEndTour}
        />
      )}

      {tourProgress && (
        <div className="status-bar status-loading">
          <span className="loading-dots"><span /><span /><span /></span>
          <span>{tourProgress}</span>
        </div>
      )}

      <div className="bottom-controls">
        {(segmentTree.length > 0) && !tourActive && (
          <button className="start-over-btn" onClick={handleStartOver}>
            Start over
          </button>
        )}
        {!tourActive && (
          <FollowUp
            onSubmit={handleFollowUp}
            disabled={isBusy}
            placeholder={followUpPlaceholder}
          />
        )}
      </div>
    </div>
  );
}
