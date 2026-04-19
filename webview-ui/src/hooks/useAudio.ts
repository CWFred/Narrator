import { useRef, useCallback, useState } from "react";

interface AudioQueueItem {
  segmentId: string;
  narrationText: string;
  audioBase64: string;
  mimeType: string;
}

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

export function useAudio(
  onSegmentStart: (segmentId: string) => void,
  onSegmentEnd: (segmentId: string) => void
) {
  const queueRef = useRef<AudioQueueItem[]>([]);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentId, setCurrentSegmentId] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const stopRequestedRef = useRef(false);
  // Cache: narration hash -> blob URL (persists across stop/reset)
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const playbackRateRef = useRef(1.0);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const [isPaused, setIsPaused] = useState(false);
  const waitingForAudioRef = useRef(false);

  const playBlobUrl = useCallback((
    blobUrl: string,
    segmentId: string,
    onEnded: () => void
  ) => {
    const audio = new Audio(blobUrl);
    audio.playbackRate = playbackRateRef.current;
    currentAudioRef.current = audio;

    audio.onended = () => {
      currentAudioRef.current = null;
      onEnded();
    };

    audio.onerror = () => {
      console.error("Audio playback error");
      currentAudioRef.current = null;
      onEnded();
    };

    audio.play().catch((err) => {
      console.error("Audio play failed:", err);
      currentAudioRef.current = null;
      onEnded();
    });
  }, []);

  const playNext = useCallback(async () => {
    if (stopRequestedRef.current) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setCurrentSegmentId(null);
      return;
    }
    if (queueRef.current.length === 0) {
      // Queue drained mid-playback; resume automatically when more pipelined
      // audio arrives via enqueue.
      waitingForAudioRef.current = true;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setCurrentSegmentId(null);
      return;
    }

    isPlayingRef.current = true;
    setIsPlaying(true);

    const item = queueRef.current.shift()!;
    setCurrentSegmentId(item.segmentId);
    onSegmentStart(item.segmentId);

    const cacheKey = hashText(item.narrationText);
    let blobUrl = audioCacheRef.current.get(cacheKey);
    if (!blobUrl) {
      blobUrl = base64ToBlobUrl(item.audioBase64, item.mimeType);
      audioCacheRef.current.set(cacheKey, blobUrl);
    }

    playBlobUrl(blobUrl, item.segmentId, () => {
      onSegmentEnd(item.segmentId);
      playNext();
    });
  }, [onSegmentStart, onSegmentEnd, playBlobUrl]);

  const enqueue = useCallback((item: AudioQueueItem) => {
    queueRef.current.push(item);
    setHasAudio(true);
    // Auto-play if waiting for audio (user clicked segment or Play All)
    if (waitingForAudioRef.current || (isPlayingRef.current && !currentAudioRef.current)) {
      waitingForAudioRef.current = false;
      playNext();
    }
  }, [playNext]);

  const getCachedBuffer = useCallback((narrationText: string): string | undefined => {
    return audioCacheRef.current.get(hashText(narrationText));
  }, []);

  // Must be called from a click handler to satisfy autoplay policy
  const play = useCallback(async () => {
    stopRequestedRef.current = false;
    if (!isPlayingRef.current) {
      if (queueRef.current.length > 0) {
        playNext();
      } else {
        // Queue is empty — mark as waiting so enqueue auto-plays when audio arrives
        waitingForAudioRef.current = true;
      }
    }
  }, [playNext]);

  const playCached = useCallback(async (segmentId: string, narrationText: string) => {
    stopRequestedRef.current = false;
    const cached = audioCacheRef.current.get(hashText(narrationText));
    if (!cached) return false;

    isPlayingRef.current = true;
    setIsPlaying(true);
    setCurrentSegmentId(segmentId);
    onSegmentStart(segmentId);

    playBlobUrl(cached, segmentId, () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setCurrentSegmentId(null);
      onSegmentEnd(segmentId);
    });

    return true;
  }, [onSegmentStart, onSegmentEnd, playBlobUrl]);

  const pause = useCallback(() => {
    if (currentAudioRef.current && !currentAudioRef.current.paused) {
      currentAudioRef.current.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (currentAudioRef.current && currentAudioRef.current.paused) {
      currentAudioRef.current.play().catch(() => {});
      setIsPaused(false);
    }
  }, []);

  const skip = useCallback(() => {
    setIsPaused(false);
    if (currentAudioRef.current) {
      // End current segment — onended fires playNext automatically
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    if (currentSegmentId) {
      onSegmentEnd(currentSegmentId);
    }
    playNext();
  }, [currentSegmentId, onSegmentEnd, playNext]);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    waitingForAudioRef.current = false;
    queueRef.current = [];
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentSegmentId(null);
    setHasAudio(false);
  }, []);

  const reset = useCallback(() => {
    stopRequestedRef.current = false;
    setHasAudio(false);
  }, []);

  const clearCache = useCallback(() => {
    // Revoke all blob URLs to free memory
    for (const url of audioCacheRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    audioCacheRef.current.clear();
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
    // Apply to currently playing audio immediately
    if (currentAudioRef.current) {
      currentAudioRef.current.playbackRate = rate;
    }
  }, []);

  return {
    enqueue, play, pause, resume, skip, playCached, stop, reset, clearCache, getCachedBuffer,
    setPlaybackRate, isPlaying, isPaused, currentSegmentId, hasAudio, playbackRate,
  };
}
