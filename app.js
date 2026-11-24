import { ShadowStage } from './stage.js';
import { exportStageMovie, movieFormat } from './export.js';

const byId = id => document.getElementById(id);
const ui = Object.fromEntries([
  'stage', 'choose', 'video-file', 'processing', 'progress-label', 'progress', 'cancel',
  'drop-target', 'play', 'play-label', 'timeline', 'time-readout', 'export', 'message', 'announcement',
  'wide', 'close', 'size', 'set-cue', 'clear-cue', 'cue-time', 'sound'
].map(id => [id, byId(id)]));
const stage = new ShadowStage(ui.stage);
const format = movieFormat();
const dropLength = 1.02;
let segmenterPromise;
let clip;
let cue = null;
let position = 0;
let busy;
let playing = false;
let frameRequest = 0;
let playbackAttempt = 0;
let lastDraw = 0;

const duration = () => clip?.duration ?? 8;
const formatTime = time => {
  const seconds = Math.max(0, Math.floor(time + 0.0001));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const formatCue = time => {
  const tenths = Math.round(time * 10);
  return `${formatTime(tenths / 10)}.${tenths % 10}`;
};

function settings() {
  return { angle: ui.wide.checked ? 'wide' : 'close', shadowSize: Number(ui.size.value), cue };
}

function draw(renderer = stage, media = clip, time = position, options = settings()) {
  const drop = options.cue === null ? 0 : Math.min(1, Math.max(0, (time - options.cue) / dropLength));
  renderer.draw({
    mask: media?.matte?.canvas ?? media?.maskVideo,
    source: media?.source,
    bounds: media?.bounds,
    angle: options.angle,
    shadowSize: options.shadowSize,
    drop,
    time
  });
}

function updateTransport() {
  const clock = `${formatTime(position)} / ${formatTime(duration())}`;
  ui.timeline.max = String(duration());
  ui.timeline.value = String(position);
  if (ui['time-readout'].textContent !== clock) ui['time-readout'].textContent = clock;
  ui.timeline.setAttribute('aria-valuetext', `${formatTime(position)} of ${formatTime(duration())}`);
  ui.play.dataset.playing = String(playing);
  ui['play-label'].textContent = playing ? 'Pause' : clip?.demo || !clip ? 'Play demo' : 'Play';
}

function setCue(time) {
  cue = time;
  ui['clear-cue'].hidden = cue === null;
  ui['cue-time'].value = cue === null ? 'Off' : formatCue(cue);
  draw();
}

function setMessage(text = '', error = false) {
  ui.message.textContent = text;
  ui.announcement.textContent = text;
  ui.message.dataset.error = String(error);
  ui.message.hidden = !text;
}

function setBusy(task) {
  busy = task;
  ui.processing.hidden = !task;
  const locked = Boolean(task) || !clip;
  for (const key of ['play', 'timeline', 'wide', 'close', 'size', 'set-cue', 'clear-cue']) ui[key].disabled = locked;
  ui.choose.disabled = Boolean(task);
  ui.export.disabled = locked || !format || !clip.recordingSource;
  ui.sound.disabled = locked || clip.demo;
  if (task) ui.cancel.focus({ preventScroll: true });
}

function setProgress(text, progress) {
  ui['progress-label'].textContent = text;
  if (progress === undefined) ui.progress.removeAttribute('value');
  else ui.progress.value = progress;
}

function stopPlayback() {
  playbackAttempt++;
  cancelAnimationFrame(frameRequest);
  if (playing && clip) position = Math.min(duration(), clip.source.currentTime);
  playing = false;
  clip?.source.pause();
  clip?.maskVideo?.pause();
  updateTransport();
}

function tick(now) {
  if (!playing || !clip) return;
  const { source, maskVideo, matte } = clip;
  position = Math.min(source.currentTime, duration());
  if (position >= duration() || source.ended) {
    stopPlayback();
    draw();
    return;
  }
  if (maskVideo && !maskVideo.seeking && Math.abs(position - maskVideo.currentTime) > 0.16) maskVideo.currentTime = position;
  const interval = matte ? 38 : 26;
  if (now - lastDraw >= interval && !source.seeking && !maskVideo?.seeking) {
    try {
      matte?.update(source);
      updateTransport();
      draw();
      lastDraw = now;
    } catch {
      stopPlayback();
      setMessage('The browser could not process this frame. Try opening the video again.', true);
      return;
    }
  }
  frameRequest = requestAnimationFrame(tick);
}

async function togglePlay() {
  if (busy || !clip) return;
  if (playing) return stopPlayback();
  if (position >= duration() - 0.04) seek(0);
  const attempt = ++playbackAttempt;
  clip.source.muted = clip.demo || !ui.sound.checked;
  try {
    // Both play requests share the button's user gesture.
    await Promise.all([clip.source.play(), clip.maskVideo?.play()]);
  } catch {
    if (attempt === playbackAttempt) {
      stopPlayback();
      setMessage('Playback could not start. Press Play to try again.', true);
    }
    return;
  }
  if (attempt !== playbackAttempt) return;
  playing = true;
  updateTransport();
  frameRequest = requestAnimationFrame(tick);
}

function seek(time) {
  if (!clip) return;
  position = Math.min(duration(), Math.max(0, time));
  const at = Math.max(0, Math.min(position, duration() - 0.01));
  clip.source.currentTime = at;
  if (clip.maskVideo) clip.maskVideo.currentTime = at;
  updateTransport();
}

function waitFor(target, name, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timeout = setTimeout(() => done(new Error('The browser could not read the video. Try a short MP4 filmed in your camera app.')), 15000);
    function done(error) {
      clearTimeout(timeout);
      target.removeEventListener(name, onEvent);
      target.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    const onEvent = () => done();
    const onError = () => done(new Error('This browser could not open the video. Try an MP4 encoded in H.264.'));
    const onAbort = () => done(signal.reason);
    target.addEventListener(name, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function makeVideo(url, signal) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.className = 'media-source';
  video.setAttribute('aria-hidden', 'true');
  const loaded = waitFor(video, 'loadeddata', signal);
  video.src = url;
  document.body.append(video);
  try {
    await loaded;
    return video;
  } catch (error) {
    releaseVideo(video);
    throw error;
  }
}

function releaseVideo(video) {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

function discardClip(media) {
  if (!media) return;
  releaseVideo(media.source);
  releaseVideo(media.maskVideo);
  releaseVideo(media.recordingSource);
  releaseVideo(media.recordingMask);
  if (media.fileUrl) URL.revokeObjectURL(media.fileUrl);
}

function showClip(media) {
  stopPlayback();
  const previous = clip;
  clip = media;
  const onSeeked = () => {
    if (clip !== media || media.source.seeking || media.maskVideo?.seeking) return;
    try {
      media.matte?.update(media.source, true);
      draw();
    } catch {
      setMessage('The browser could not display this frame.', true);
    }
  };
  media.source.addEventListener('seeked', onSeeked);
  media.maskVideo?.addEventListener('seeked', onSeeked);
  position = 0;
  ui.sound.checked = !media.demo;
  setCue(media.demo ? 5.7 : null);
  updateTransport();
  discardClip(previous);
}

async function seekVideo(video, at, signal) {
  if (Math.abs(video.currentTime - at) < 0.002 && !video.seeking) return;
  const ready = waitFor(video, 'seeked', signal);
  video.currentTime = at;
  await ready;
}

function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = import('./segment.js').then(module => module.createSegmenter()).catch(error => {
      console.error(error);
      segmenterPromise = null;
      throw new Error('The silhouette engine could not start. Reopen this page in a current version of Safari or Chrome and try again.');
    });
  }
  return segmenterPromise;
}

function createMatte(segmenter) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  let pixels;
  let lastTime = -1;
  let frameID = 0;
  return {
    canvas,
    update(source, force = false) {
      if (!force && Math.abs(lastTime - source.currentTime) < 0.012) return;
      const { width, height, data } = segmenter.segment(source);
      if (!pixels || width !== canvas.width || height !== canvas.height) {
        canvas.width = width;
        canvas.height = height;
        pixels = context.createImageData(width, height);
      }
      const rgba = pixels.data;
      for (let index = 0, pixel = 0; index < data.length; index++, pixel += 4) {
        const value = Math.round(Math.max(0, data[index] - 0.15) * 300);
        rgba[pixel] = rgba[pixel + 1] = rgba[pixel + 2] = value;
        rgba[pixel + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      canvas.currentTime = ++frameID;
      lastTime = source.currentTime;
      return { width, height, data };
    }
  };
}

function measureBounds(frame, previous) {
  const { width, height, data } = frame;
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    let rowCount = 0;
    let rowLeft = width;
    let rowRight = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] >= 0.68) {
        rowLeft = Math.min(rowLeft, x);
        rowRight = x + 1;
        rowCount++;
      }
    }
    if (rowCount < 3) continue;
    left = Math.min(left, rowLeft);
    right = Math.max(right, rowRight);
    top = Math.min(top, y);
    bottom = y + 1;
    count += rowCount;
  }
  if (count < width * height * 0.008) return previous;
  const next = { left: left / width, right: right / width, top: top / height, bottom: bottom / height };
  return previous ? {
    left: Math.min(previous.left, next.left),
    right: Math.max(previous.right, next.right),
    top: Math.min(previous.top, next.top),
    bottom: Math.max(previous.bottom, next.bottom)
  } : next;
}

async function frameDancer(media, signal) {
  let bounds;
  const steps = 9;
  // Let the decoded frame reach the canvas before sampling for the first time.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (let index = 0; index < steps; index++) {
    signal.throwIfAborted();
    await seekVideo(media.source, media.duration * 0.94 * index / (steps - 1), signal);
    bounds = measureBounds(media.matte.update(media.source, true), bounds);
    setProgress('Finding your shadow…', (index + 1) / steps);
  }
  if (!bounds) throw new Error('No dancer was found. Try a well-lit shot that shows one person from head to toe.');
  const x = Math.max(0, bounds.left - 0.012);
  const y = Math.max(0, bounds.top - 0.012);
  const right = Math.min(1, bounds.right + 0.012);
  const bottom = Math.min(1, bounds.bottom + 0.01);
  media.bounds = { x, y, width: right - x, height: bottom - y };
  await seekVideo(media.source, 0, signal);
  media.matte.update(media.source, true);
}

async function chooseVideo(file) {
  if (!file || busy) return;
  stopPlayback();
  const task = { controller: new AbortController() };
  const signal = task.controller.signal;
  const media = { fileUrl: URL.createObjectURL(file), demo: false };
  setMessage();
  setProgress('Opening your video…');
  ui.announcement.textContent = 'Preparing your video.';
  setBusy(task);
  try {
    media.source = await makeVideo(media.fileUrl, signal);
    media.duration = media.source.duration;
    if (!Number.isFinite(media.duration) || media.duration <= 0) {
      throw new Error('This video has no playable length. Try a short MP4.');
    }
    setProgress('Loading the silhouette engine…');
    const segmenter = await getSegmenter();
    signal.throwIfAborted();
    media.matte = createMatte(segmenter);
    await frameDancer(media, signal);
    if (format) media.recordingSource = await makeVideo(media.fileUrl, signal);
    showClip(media);
    setMessage(`Now on stage: ${file.name}`);
  } catch (error) {
    discardClip(media);
    if (!signal.aborted) setMessage(error.message, true);
    else ui.announcement.textContent = 'Video preparation canceled.';
  } finally {
    setBusy(null);
    (signal.aborted || !clip ? ui.choose : ui.play).focus({ preventScroll: true });
  }
}

async function saveMovie() {
  if (!clip || busy || !format) return;
  stopPlayback();
  setMessage();
  const task = { controller: new AbortController() };
  const signal = task.controller.signal;
  const options = settings();
  const media = {
    ...clip,
    source: clip.recordingSource,
    maskVideo: clip.recordingMask,
    matte: clip.matte
  };
  const includeAudio = ui.sound.checked && !clip.demo;
  const canvas = document.createElement('canvas');
  canvas.width = ui.stage.width;
  canvas.height = ui.stage.height;
  const renderer = new ShadowStage(canvas);

  setProgress('Starting the export…');
  ui.announcement.textContent = 'Recording your movie. Keep this tab in view.';
  setBusy(task);
  try {
    if (media.maskVideo) {
      media.maskVideo.currentTime = 0;
      void media.maskVideo.play().catch(() => {});
    }
    const { blob, extension, format: savedFormat } = await exportStageMovie({
      canvas,
      source: media.source,
      duration: media.duration,
      includeAudio,
      renderFrame(time) {
        if (media.maskVideo && !media.maskVideo.seeking && Math.abs(time - media.maskVideo.currentTime) > 0.12) {
          media.maskVideo.currentTime = Math.min(time, media.duration - 0.01);
        }
        media.matte?.update(media.source, time === 0);
        draw(renderer, media, time, options);
      },
      signal,
      onProgress(progress) { setProgress('Recording your movie… Keep this tab in view.', progress); }
    });
    const download = document.createElement('a');
    const url = URL.createObjectURL(blob);
    download.href = url;
    download.download = `Henry’s Shadow Stage.${extension}`;
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setMessage(`Your ${savedFormat} is ready. Check your browser’s downloads.`);
  } catch (error) {
    if (!signal.aborted) setMessage(error.message, true);
    else ui.announcement.textContent = 'Movie export canceled.';
  } finally {
    media.maskVideo?.pause();
    releaseVideo(media.source);
    clip.recordingSource = null;
    try {
      // Web Audio can attach to a media element only once. A fresh element also starts at zero.
      clip.recordingSource = await makeVideo(clip.fileUrl ?? './demo/source.mp4', new AbortController().signal);
      if (clip.recordingMask) {
        await seekVideo(clip.recordingMask, 0, new AbortController().signal);
      }
      clip.matte?.update(clip.source, true);
      draw();
    } catch (error) {
      console.error(error);
      if (!clip.recordingSource) setMessage('The recording preview could not reopen. Choose your video again to make another recording.', true);
    }
    setBusy(null);
    ui.export.focus({ preventScroll: true });
  }
}

ui.choose.addEventListener('click', () => ui['video-file'].click());
ui['video-file'].addEventListener('change', () => {
  void chooseVideo(ui['video-file'].files[0]);
  ui['video-file'].value = '';
});
ui.cancel.addEventListener('click', () => busy?.controller.abort());
ui.play.addEventListener('click', () => { void togglePlay(); });
ui.timeline.addEventListener('input', () => seek(Number(ui.timeline.value)));
ui.wide.addEventListener('change', () => draw());
ui.close.addEventListener('change', () => draw());
ui.size.addEventListener('input', () => draw());
ui['set-cue'].addEventListener('click', () => setCue(position));
ui['clear-cue'].addEventListener('click', () => setCue(null));
ui.sound.addEventListener('change', () => { if (clip) clip.source.muted = !ui.sound.checked; });
ui.export.addEventListener('click', () => { void saveMovie(); });

let dragDepth = 0;
const isFileDrag = event => Array.from(event.dataTransfer?.types ?? []).includes('Files');
window.addEventListener('dragenter', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  if (!busy) ui['drop-target'].hidden = false;
});
window.addEventListener('dragover', event => {
  if (isFileDrag(event)) event.preventDefault();
});
window.addEventListener('dragleave', event => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) ui['drop-target'].hidden = true;
});
window.addEventListener('drop', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  ui['drop-target'].hidden = true;
  void chooseVideo(event.dataTransfer.files[0]);
});

async function loadDemo() {
  const media = { demo: true };
  const controller = new AbortController();
  const signal = controller.signal;
  try {
    const response = await fetch('./demo/media.json');
    if (!response.ok) throw new Error('The demo could not load.');
    const { bounds, duration } = await response.json();
    Object.assign(media, { bounds, duration });
    const sources = [
      ['source', './demo/source.mp4'],
      ['maskVideo', './demo/mask.mp4'],
      ...(format ? [['recordingSource', './demo/source.mp4'], ['recordingMask', './demo/mask.mp4']] : [])
    ];
    await Promise.all(sources.map(async ([key, url]) => { media[key] = await makeVideo(url, signal); }));
    if (clip) return discardClip(media);
    showClip(media);
    if (!busy) setBusy(null);
  } catch {
    controller.abort();
    discardClip(media);
    if (!clip && !busy) setMessage('The demo could not load. You can still choose a dance video.', true);
  }
}

if (format) ui.export.textContent = `Save ${format.format}`;
updateTransport();
draw();
setBusy(null);
void loadDemo();
