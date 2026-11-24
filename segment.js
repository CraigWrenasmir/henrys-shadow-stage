const maskLongEdge = 320;

export async function createSegmenter() {
  const { FilesetResolver, ImageSegmenter } = await import('./vendor/vision_bundle.mjs');
  const wasm = await FilesetResolver.forVisionTasks(new URL('./vendor/wasm', import.meta.url).href);
  const task = await ImageSegmenter.createFromOptions(wasm, {
    baseOptions: {
      modelAssetPath: new URL('./vendor/selfie_segmenter.tflite', import.meta.url).href,
      delegate: 'CPU'
    },
    canvas: document.createElement('canvas'),
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true
  });
  const input = document.createElement('canvas');
  const context = input.getContext('2d', { alpha: false });
  let lastTimestamp = -1;
  let closed = false;

  return {
    segment(image, milliseconds = performance.now()) {
      if (closed) throw new Error('The silhouette model is closed.');
      const sourceWidth = image.videoWidth || image.naturalWidth || image.width;
      const sourceHeight = image.videoHeight || image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) throw new Error('The video frame is unavailable.');
      const scale = Math.min(1, maskLongEdge / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      if (input.width !== width || input.height !== height) {
        input.width = width;
        input.height = height;
      }
      context.drawImage(image, 0, 0, width, height);

      // The graph needs advancing timestamps, including when the user seeks backwards.
      lastTimestamp = Math.max(lastTimestamp + 1, Math.round(milliseconds));
      let frame;
      task.segmentForVideo(input, lastTimestamp, ({ confidenceMasks }) => {
        // A one-channel selfie model returns foreground alone.
        const foreground = confidenceMasks?.[1] ?? confidenceMasks?.[0];
        if (!foreground) return;
        frame = {
          width: foreground.width,
          height: foreground.height,
          data: foreground.getAsFloat32Array().slice()
        };
      });
      if (!frame) throw new Error('The silhouette model did not return a video frame.');
      return frame;
    },
    close() {
      if (closed) return;
      closed = true;
      task.close();
    }
  };
}
