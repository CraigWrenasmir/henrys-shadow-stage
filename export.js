const FRAME_RATE = 30;
const FRAME_INTERVAL = 1000 / FRAME_RATE;

function formats(includeAudio) {
  const avc = includeAudio ? 'avc1,mp4a.40.2' : 'avc1';
  const vp8 = includeAudio ? 'vp8,opus' : 'vp8';
  return [
    { format: 'MP4', extension: 'mp4', mimeType: 'video/mp4;codecs=' + avc },
    { format: 'MP4', extension: 'mp4', mimeType: 'video/mp4' },
    { format: 'WebM', extension: 'webm', mimeType: 'video/webm;codecs=' + vp8 },
    { format: 'WebM', extension: 'webm', mimeType: 'video/webm' }
  ];
}

function supportedFormats(includeAudio) {
  if (typeof MediaRecorder === 'undefined' ||
      typeof HTMLCanvasElement.prototype.captureStream !== 'function') return [];
  return formats(includeAudio).filter(candidate => MediaRecorder.isTypeSupported(candidate.mimeType));
}

export function movieFormat(includeAudio = true) {
  return supportedFormats(includeAudio)[0] ?? null;
}

function startRecording(stream, includeAudio, candidates) {
  for (const format of candidates) {
    try {
      const options = { mimeType: format.mimeType, videoBitsPerSecond: 6_000_000 };
      if (includeAudio) options.audioBitsPerSecond = 160_000;
      const recorder = new MediaRecorder(stream, options);
      recorder.start();
      return { recorder, ...format };
    } catch {
      // Some browsers report support but cannot start that encoder on this device.
    }
  }
  throw new Error('Your browser could not start a video recording. Try closing other video tabs and saving again.');
}

function recordResult(recorder, mimeType) {
  const parts = [];
  return new Promise((resolve, reject) => {
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) parts.push(event.data);
    });
    recorder.addEventListener('error', () => reject(new Error('The browser stopped recording before the movie was ready.')),
      { once: true });
    recorder.addEventListener('stop', () => {
      if (!parts.length) {
        reject(new Error('The browser did not capture any video frames. Try saving again.'));
        return;
      }
      resolve(new Blob(parts, { type: mimeType.split(';')[0] }));
    }, { once: true });
  });
}

function renderWhilePlaying({ source, duration, renderFrame, capture, onProgress, initialFrame, signal }) {
  return new Promise((resolve, reject) => {
    let animation;
    let finalHold;
    let lastDraw = -Infinity;
    let lastTime = -1;
    let lastProgress = -1;
    let lastAdvance = performance.now();
    let done = false;
    const watchdog = setInterval(() => {
      if (performance.now() - lastAdvance > 12_000) {
        finish(new Error('The video stopped playing during export. Keep this tab visible and try again.'));
      }
    }, 1000);

    function finish(error) {
      if (done) return;
      done = true;
      cancelAnimationFrame(animation);
      clearInterval(watchdog);
      clearTimeout(finalHold);
      source.removeEventListener('error', onVideoError);
      document.removeEventListener('visibilitychange', onVisibility);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }

    function onVideoError() {
      finish(new Error('The browser could not read part of the original video.'));
    }

    function onVisibility() {
      if (document.hidden) {
        finish(new Error('The export was interrupted when this tab was hidden. Keep it visible while saving.'));
      }
    }

    function onAbort() {
      finish(signal.reason ?? new DOMException('Export cancelled', 'AbortError'));
    }

    async function draw(now) {
      if (done) return;
      const time = Math.min(source.currentTime, duration);
      const atEnd = source.ended || time >= duration;
      if (time > lastTime) lastAdvance = now;
      if (atEnd || (time > lastTime && now - lastDraw >= FRAME_INTERVAL - 1.5 &&
          !source.seeking && source.readyState >= 2)) {
        lastTime = time;
        lastDraw = now;
        try {
          await renderFrame(atEnd ? Math.max(0, duration - 0.004) : time);
          if (done) return;
          capture();
          const progress = Math.floor(time / duration * 100);
          if (progress !== lastProgress) onProgress(progress / 100);
          lastProgress = progress;
        } catch (error) {
          finish(error);
          return;
        }
      }
      if (atEnd) {
        finalHold = setTimeout(() => finish(), FRAME_INTERVAL + 6);
      } else {
        animation = requestAnimationFrame(draw);
      }
    }

    source.addEventListener('error', onVideoError);
    document.addEventListener('visibilitychange', onVisibility);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(initialFrame).then(() => {
      if (done) return;
      capture();
      animation = requestAnimationFrame(draw);
    }, finish);
    if (signal.aborted) onAbort();
    else if (document.hidden) onVisibility();
  });
}

// Supply a paused video at its first frame. Use a fresh element each time
// the original audio is included, since Web Audio binds it to that element.
export async function exportStageMovie({ canvas, source, duration = source.duration, includeAudio = true,
  renderFrame, signal, onProgress = () => {} }) {
  const candidates = supportedFormats(includeAudio);
  if (!candidates.length) throw new Error('Video export needs a browser with canvas recording support.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video has no playable duration.');
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  let stream;
  let audioContext;
  let recorder;
  let finishTimer;

  try {
    stream = canvas.captureStream(FRAME_RATE);
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('The browser could not capture the stage.');

    source.loop = false;
    source.playbackRate = 1;
    source.playsInline = true;
    source.muted = !includeAudio;
    if (includeAudio) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser cannot record the original sound. Turn Sound off and try again.');
      audioContext = new AudioContext();
      const input = audioContext.createMediaElementSource(source);
      const output = audioContext.createMediaStreamDestination();
      input.connect(output);
      stream.addTrack(output.stream.getAudioTracks()[0]);
    }

    // Start audio and playback on the click that initiated export, before awaiting a frame.
    const ready = audioContext?.resume();
    const initialFrame = (async () => renderFrame(0))();
    const playback = source.play();
    const frames = renderWhilePlaying({
      source, duration, renderFrame, onProgress, initialFrame, signal: controller.signal,
      capture: () => videoTrack.requestFrame?.()
    });
    const started = Promise.all([ready, playback]);
    const rendered = Promise.all([started, frames]);
    // Start the encoder once the video starts moving to avoid recording a still lead-in.
    await Promise.race([started, rendered]);
    controller.signal.throwIfAborted();
    const recording = startRecording(stream, includeAudio, candidates);
    recorder = recording.recorder;
    const result = recordResult(recorder, recording.mimeType);
    const endedEarly = result.then(() => { throw new Error('The browser recording ended before playback finished.'); });
    await Promise.race([endedEarly, rendered]);
    controller.signal.throwIfAborted();
    source.pause();
    recorder.stop();

    const deadline = new Promise((_, reject) => {
      finishTimer = setTimeout(() => reject(new Error('The browser could not finish saving the movie. Try again.')), 15_000);
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    const blob = await Promise.race([result, deadline]);
    return { blob, format: recording.format, extension: recording.extension };
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', cancel);
    clearTimeout(finishTimer);
    source.pause();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(() => {});
  }
}
