const WIDTH = 1280;
const HEIGHT = 720;
const TAU = Math.PI * 2;

const VIEWS = {
  close: { x: 28, y: 29, w: 1224, h: 588, light: 0.609 },
  wide: { x: 174, y: 113, w: 930, h: 408, light: 0.615 }
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function ellipseGradient(ctx, x, y, rx, ry, stops) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function clothTexture() {
  const width = 1000;
  const height = 520;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const random = seededRandom(16713);
  const foldCount = 26;
  const folds = Array.from({ length: foldCount }, (_, index) => ({
    x: (index + 0.5 + (random() - 0.5) * 0.82) / foldCount,
    width: 0.004 + random() * 0.015,
    intensity: 0.09 + random() * 0.37,
    curve: random() * TAU,
    bias: (random() - 0.5) * 0.025,
    seam: index % 4 === 1
  }));
  const row = new Float32Array(width);

  for (let py = 0; py < height; py++) {
    const y = py / (height - 1);
    row.fill(0);
    for (const fold of folds) {
      const looserHem = y ** 6;
      const axis = fold.x + Math.sin(y * 3.9 + fold.curve) * 0.0022 +
        fold.bias * (y ** 2 + Math.sin(y * 8.5 + fold.curve) * looserHem);
      const span = fold.width * (0.69 + 0.40 * Math.sin((y + 0.18) * Math.PI)) +
        0.0035 * looserHem;
      const left = Math.max(0, Math.floor((axis - span * 3.5) * width));
      const right = Math.min(width - 1, Math.ceil((axis + span * 3.5) * width));
      for (let px = left; px <= right; px++) {
        const d = (px / width - axis) / span;
        const bright = Math.exp(-((d - 0.45) ** 2) / 0.72);
        const dark = Math.exp(-((d + 0.39) ** 2) / 0.43);
        const seam = fold.seam ? Math.exp(-((d + 0.05) ** 2) / 0.034) : 0;
        row[px] += fold.intensity * (0.6 * bright - dark) - 0.22 * seam;
      }
    }

    for (let px = 0; px < width; px++) {
      const x = px / (width - 1);
      const edge = smooth(0, 0.15, x) * smooth(0, 0.14, 1 - x);
      const screenFalloff = 0.34 + 0.66 * edge;
      const upperDarkness = smooth(-0.09, 0.48, y);
      const spread = 0.047 + (1 - y) * 0.235;
      const beam = Math.exp(-(((x - 0.611 - (1 - y) * 0.076) / spread) ** 2)) *
        (0.23 + 0.77 * y ** 1.9) * upperDarkness;
      const flood = Math.exp(-(((x - 0.53) / 0.47) ** 2 + ((y - 0.79) / 0.59) ** 2));
      const coolWash = Math.exp(-(((x - 0.23) / 0.22) ** 2 + ((y - 0.52) / 0.42) ** 2));
      const lampSpread = 0.012 + 0.026 * (1 - y);
      const lamp = Math.exp(-(((x - 0.608) / lampSpread) ** 2 + ((1.016 - y) / 0.18) ** 2));
      const bounce = Math.exp(-((1 - y) / 0.047)) * (0.12 + 0.41 * screenFalloff);
      const foldsAtEdges = Math.sin(x * 157 + Math.sin(y * 5) * 0.65) *
        (0.075 * (1 - edge) + 0.023 + (y ** 8) * 0.10);
      const broadWrinkle = Math.sin(x * 29 + y * 1.4) * 0.04 +
        Math.sin(x * 69 - y * 2.7) * 0.022;
      const transmission = 1 + (row[px] + foldsAtEdges + broadWrinkle) * (0.75 + 0.42 * y);
      const illumination = (13 + 18 * upperDarkness + flood * 89 + beam * 39 +
        coolWash * 16 + bounce * 23 + lamp * 126) * screenFalloff * transmission;
      const weave = (random() - 0.5) * 4.6 + (py % 3 === 0 ? 0.8 : -0.22) +
        (px % 3 === 0 ? -0.9 : 0.15);
      const offset = (py * width + px) * 4;
      image.data[offset] = illumination * 0.815 + lamp * 16 + weave;
      image.data[offset + 1] = illumination * 0.945 + coolWash * 4 + lamp * 8 + weave;
      image.data[offset + 2] = illumination * 1.12 + coolWash * 8 + weave;
      image.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function background(view, wide) {
  const canvas = makeCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const floorY = view.y + view.h;
  const axis = view.x + view.w * view.light;
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ellipseGradient(ctx, view.x + view.w * 0.48, floorY - view.h * 0.32,
    view.w * 0.61, view.h * 0.89, [
      [0, '#14202d'], [0.34, '#101924cf'], [0.67, '#0d17236b'], [1, '#0d172300']
    ]);
  ellipseGradient(ctx, axis, floorY * 0.88, view.w * 0.61, view.h * 0.77, [
    [0, '#848fa42d'], [0.36, '#637a9a21'], [0.78, '#28394d19'], [1, '#28394d00']
  ]);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const beams = [
    [view.x + view.w * 0.16, view.y + view.h * 0.04, axis + view.w * 0.08, 0.105],
    [view.x + view.w * 0.86, view.y + view.h * 0.01, axis - view.w * 0.26, 0.135],
    [view.x + view.w * 0.72, view.y + view.h * 0.12, axis - view.w * 0.11, 0.072]
  ];
  for (const [lightX, lightY, targetX, beamWidth] of beams) {
    const gradient = ctx.createLinearGradient(0, lightY, 0, floorY);
    gradient.addColorStop(0, 'rgba(186,200,233,0.27)');
    gradient.addColorStop(0.22, 'rgba(163,188,223,0.135)');
    gradient.addColorStop(1, 'rgba(173,200,242,0.016)');
    ctx.fillStyle = gradient;
    ctx.filter = 'blur(6px)';
    ctx.beginPath();
    ctx.moveTo(lightX - 2, lightY);
    ctx.lineTo(lightX + 2, lightY);
    ctx.lineTo(targetX + view.w * beamWidth, floorY + 8);
    ctx.lineTo(targetX - view.w * beamWidth, floorY + 8);
    ctx.fill();
  }
  ctx.restore();

  const deck = ctx.createLinearGradient(0, floorY - 4, 0, floorY + (wide ? 91 : 120));
  deck.addColorStop(0, '#25313c');
  deck.addColorStop(0.055, '#19222b');
  deck.addColorStop(1, '#05070b');
  ctx.fillStyle = deck;
  ctx.beginPath();
  ctx.moveTo(view.x - 6, floorY - 4);
  ctx.lineTo(view.x + view.w + 6, floorY - 4);
  ctx.lineTo(view.x + view.w + 55, floorY + 125);
  ctx.lineTo(view.x - 55, floorY + 125);
  ctx.closePath();
  ctx.fill();
  ellipseGradient(ctx, axis, floorY + 2, view.w * 0.38, wide ? 36 : 44, [
    [0, '#bbcad25c'], [0.32, '#91a5ba34'], [1, '#778ba000']
  ]);
  ellipseGradient(ctx, axis, floorY + 5, view.w * 0.09, 18, [
    [0, '#dadde962'], [1, '#dadde900']
  ]);

  if (wide) {
    const random = seededRandom(684);
    ctx.fillStyle = '#04060a';
    ctx.beginPath();
    ctx.moveTo(0, 617);
    ctx.lineTo(264, 599);
    ctx.lineTo(908, 605);
    ctx.lineTo(WIDTH, 616);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.lineTo(0, HEIGHT);
    ctx.fill();
    for (let row = 0; row < 5; row++) {
      for (let index = 0; index < 92; index++) {
        const x = index * 14 + (random() - 0.5) * 16;
        if (x > 547 && x < 715) continue;
        const y = 621 + row * 23 + 8 * Math.sin(x / 200) + random() * 20;
        ctx.fillStyle = random() > 0.94 ? '#a5a09845' : '#667a9420';
        ctx.beginPath();
        ctx.ellipse(x, y, 2 + random() * 3.8, 0.7 + random() * 1.9, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  const heightShade = ctx.createLinearGradient(0, 0, 0, view.y + 33);
  heightShade.addColorStop(0, '#030508');
  heightShade.addColorStop(1, '#03050800');
  ctx.fillStyle = heightShade;
  ctx.fillRect(0, 0, WIDTH, view.y + 34);
  return canvas;
}

function curtainPoint(view, x, drop) {
  const hem = view.y + view.h;
  const ease = smooth(0.69, 1, drop);
  const releaseDelay = Math.exp(-(((x - 0.46) / 0.29) ** 2)) * 0.38 +
    Math.sin(x * 13) * 0.027;
  const fall = clamp((drop - releaseDelay) / (0.91 - releaseDelay)) ** 1.52;
  const gathering = smooth(0.12, 0.69, drop);
  const sideIn = (0.46 - x) * (0.2 * gathering + 0.13 * ease);
  const edgeSwell = Math.sin(x * 37 + 1) * 2.1 + Math.sin(x * 12 + 0.3) * 3.5;
  const wavering = Math.sin(x * 17 + drop * 11) * 8 * Math.sin(Math.PI * fall);
  const top = Math.min(hem + 2, view.y + edgeSwell + fall * view.h + wavering);
  const bottom = hem + Math.sin(x * 61) * (1.7 + 3 * ease) +
    Math.sin(x * 20 + drop * 5) * 2.7 + ease * 5.7;
  const xPosition = view.x + view.w * (x + sideIn);
  return { x: xPosition, top, bottom: Math.max(top + 4, bottom) };
}

function paintCurtainSide(ctx, point, right, fromTop, drop) {
  const direction = right ? -1 : 1;
  const height = point.bottom - point.top;
  for (let step = 1; step <= 16; step++) {
    const y = fromTop ? step / 16 : 1 - step / 16;
    const inward = Math.sin(y * Math.PI) * (5.0 + Math.sin(y * 10 + direction) * 3.7) *
      (1 + drop * 1.45) * direction;
    ctx.lineTo(point.x + inward, point.top + height * y);
  }
}

function stageVignette(view, wide) {
  const canvas = makeCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ellipseGradient(ctx, WIDTH * 0.50, HEIGHT * 0.48, WIDTH * 0.74, HEIGHT * 0.76, [
    [0, '#02050900'], [0.57, '#02050900'], [0.85, '#02050940'], [1, '#020509a0']
  ]);
  const edge = ctx.createLinearGradient(0, 0, WIDTH, 0);
  edge.addColorStop(0, '#03060be3');
  edge.addColorStop(wide ? 0.16 : 0.072, '#03060b00');
  edge.addColorStop(wide ? 0.84 : 0.928, '#03060b00');
  edge.addColorStop(1, '#03060be3');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const hem = view.y + view.h;
  const bottomShadow = ctx.createLinearGradient(0, hem - 2, 0, hem + (wide ? 42 : 37));
  bottomShadow.addColorStop(0, '#04070c00');
  bottomShadow.addColorStop(0.23, '#04070c33');
  bottomShadow.addColorStop(1, '#04070c00');
  ctx.fillStyle = bottomShadow;
  ctx.fillRect(0, hem - 2, WIDTH, wide ? 44 : 39);
  return canvas;
}

function mediaSize(media) {
  if (!media || ('readyState' in media && media.readyState < 2)) return null;
  const width = media.videoWidth || media.naturalWidth || media.width;
  const height = media.videoHeight || media.naturalHeight || media.height;
  return width > 0 && height > 0 ? { width, height } : null;
}

function normalizeBounds(bounds) {
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const x = clamp(bounds.x, 0, 0.98);
  const y = clamp(bounds.y, 0, 0.98);
  const width = clamp(bounds.width, 0.02, 1 - x);
  const height = clamp(bounds.height, 0.02, 1 - y);
  return { x, y, width, height };
}

function project(view, media, bounds, scale, isReveal = false) {
  const personWidth = bounds.width * media.width;
  const personHeight = bounds.height * media.height;
  const fit = Math.min(view.h * (isReveal ? 0.80 : 0.934) / personHeight,
    view.w * (isReveal ? 0.79 : 0.885) / personWidth);
  const ratio = fit * scale;
  const floor = view.y + view.h * (isReveal ? 1.024 : 0.985);
  const margin = 0.035;
  const left = Math.max(0, bounds.x - margin);
  const top = Math.max(0, bounds.y - margin);
  const width = Math.min(1, bounds.x + bounds.width + margin) - left;
  const height = Math.min(1, bounds.y + bounds.height + margin) - top;
  return {
    x: view.x + view.w * 0.5 + ((left - bounds.x) * media.width - personWidth / 2) * ratio,
    y: floor + ((top - bounds.y) * media.height - personHeight) * ratio,
    w: width * media.width * ratio,
    h: height * media.height * ratio,
    crop: { left, top, width, height }
  };
}

function compositeAt(ctx, image, geometry) {
  const { left, top, width, height } = geometry.crop;
  ctx.drawImage(image, left * image.width, top * image.height, width * image.width,
    height * image.height, geometry.x, geometry.y, geometry.w, geometry.h);
}

function demoDancer(canvas, time, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const phase = time * 2.35;
  const hip = [w * 0.50 + Math.sin(phase * 0.53) * w * 0.085,
    h * 0.56 + Math.sin(phase * 2) * h * 0.016];
  const shoulder = [hip[0] + Math.sin(phase + 1.75) * w * 0.075, hip[1] - h * 0.27];
  const head = [shoulder[0] + Math.sin(phase + 2) * 9, shoulder[1] - h * 0.091];
  const legPose = side => {
    const swing = phase + side * Math.PI / 2;
    return {
      start: [hip[0] + side * 14, hip[1]],
      knee: [hip[0] + side * 38 + 15 * Math.cos(swing), h * 0.74],
      foot: [hip[0] + side * 52 + 32 * Math.sin(swing), h * 0.931 - Math.max(0, Math.cos(swing)) * 31]
    };
  };
  const armPose = side => {
    const swing = phase + side * Math.PI / 2;
    const elbow = [shoulder[0] + side * (46 + 28 * Math.max(0, Math.cos(swing))),
      shoulder[1] + 47 + 17 * Math.sin(swing)];
    return {
      start: [shoulder[0] + side * 25, shoulder[1] + 10],
      elbow,
      hand: [elbow[0] + side * (15 + 22 * Math.cos(swing)),
        elbow[1] + 38 * Math.sin(swing + 0.37)]
    };
  };
  const strokeSegment = (from, to, width) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(...to);
    ctx.stroke();
  };

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const side of [-1, 1]) {
    const { start, knee, foot } = legPose(side);
    strokeSegment(start, knee, 39);
    strokeSegment(knee, foot, 27);
    strokeSegment(foot, [foot[0] + side * 12 + 10, foot[1] + 1], 17);
  }

  for (const side of [-1, 1]) {
    const { start, elbow, hand } = armPose(side);
    strokeSegment(start, elbow, 28);
    strokeSegment(elbow, hand, 20);
    strokeSegment(hand, [hand[0] + side * 5, hand[1] + 8], 14);
  }

  strokeSegment(shoulder, head, 22);
  ctx.beginPath();
  ctx.moveTo(shoulder[0] - 32, shoulder[1] - 4);
  ctx.quadraticCurveTo(shoulder[0], shoulder[1] - 18, shoulder[0] + 32, shoulder[1] - 3);
  ctx.lineTo(hip[0] + 26, hip[1] + 15);
  ctx.quadraticCurveTo(hip[0], hip[1] + 27, hip[0] - 29, hip[1] + 14);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.translate(...head);
  ctx.rotate(Math.sin(phase) * 0.23 - 0.12);
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 28, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export class ShadowStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.texture = clothTexture();
    this.views = {};
    this.maskCanvas = makeCanvas(1, 1);
    this.maskContext = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.alphaCanvas = makeCanvas(1, 1);
    this.alphaContext = this.alphaCanvas.getContext('2d');
    this.colorCanvas = makeCanvas(1, 1);
    this.colorContext = this.colorCanvas.getContext('2d');
    this.demoCanvas = makeCanvas(420, 440);
    this.threshold = null;
  }

  readMask(mask, dimensions, threshold) {
    const currentTime = Number.isFinite(mask.currentTime) ? mask.currentTime : null;
    if (currentTime !== null && this.maskSource === mask && this.maskTime === currentTime &&
        this.threshold === threshold) {
      return this.alphaCanvas;
    }

    const ratio = Math.min(1, 640 / Math.max(dimensions.width, dimensions.height));
    const width = Math.max(1, Math.round(dimensions.width * ratio));
    const height = Math.max(1, Math.round(dimensions.height * ratio));
    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = this.alphaCanvas.width = width;
      this.maskCanvas.height = this.alphaCanvas.height = height;
    }
    this.maskContext.clearRect(0, 0, width, height);
    this.maskContext.drawImage(mask, 0, 0, width, height);
    const image = this.maskContext.getImageData(0, 0, width, height);
    const { data } = image;
    const softness = 110 - threshold;
    for (let index = 0; index < data.length; index += 4) {
      const t = clamp((data[index] - threshold) / softness);
      data[index] = 5;
      data[index + 1] = 11;
      data[index + 2] = 22;
      data[index + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
    this.alphaContext.putImageData(image, 0, 0);
    this.maskSource = mask;
    this.maskTime = currentTime;
    this.threshold = threshold;
    return this.alphaCanvas;
  }

  cutOut(source, alpha) {
    const dimensions = mediaSize(source);
    if (!dimensions) return null;
    const ratio = Math.min(1, 960 / Math.max(dimensions.width, dimensions.height));
    const width = Math.max(1, Math.round(dimensions.width * ratio));
    const height = Math.max(1, Math.round(dimensions.height * ratio));
    if (this.colorCanvas.width !== width || this.colorCanvas.height !== height) {
      this.colorCanvas.width = width;
      this.colorCanvas.height = height;
    }

    const ctx = this.colorContext;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(alpha, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    return this.colorCanvas;
  }

  paintCloth(view, drop, shadow, shadowGeometry, softness) {
    const ctx = this.ctx;
    const samples = 96;
    const positions = Array.from({ length: samples + 1 }, (_, index) =>
      curtainPoint(view, index / samples, drop));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(positions[0].x, positions[0].top);
    for (const point of positions) ctx.lineTo(point.x, point.top);
    paintCurtainSide(ctx, positions[samples], true, true, drop);
    for (let index = samples; index >= 0; index--) {
      const point = positions[index];
      ctx.lineTo(point.x, point.bottom);
    }
    paintCurtainSide(ctx, positions[0], false, false, drop);
    ctx.closePath();
    ctx.clip();

    const texture = this.texture;
    if (drop < 0.002) {
      ctx.drawImage(texture, view.x, view.y - 10, view.w, view.h + 16);
    } else {
      const stripWidth = texture.width / samples;
      for (let index = 0; index < samples; index++) {
        const start = positions[index];
        const end = positions[index + 1];
        const top = Math.min(start.top, end.top);
        const bottom = Math.max(start.bottom, end.bottom);
        ctx.drawImage(texture, index * stripWidth, 0, stripWidth, texture.height,
          start.x, top, end.x - start.x + 0.8, bottom - top);
      }

      ctx.fillStyle = 'rgba(2,6,14,' + (drop * 0.56) + ')';
      ctx.fillRect(view.x, view.y, view.w, view.h + 25);
    }

    if (shadow && shadowGeometry) {
      const alpha = (1 - smooth(0.49, 0.94, drop)) * 0.953;
      ctx.globalAlpha = alpha;
      if (softness > 0.03) ctx.filter = 'blur(' + softness * 1.8 + 'px)';
      compositeAt(ctx, shadow, shadowGeometry);
      ctx.filter = 'none';
    }
    ctx.restore();
  }

  draw({ mask, source, bounds, angle = 'close', shadowSize = 1, softness = 1,
    drop = 0, time = 0, demo = false } = {}) {
    const isWide = angle === 'wide';
    const view = isWide ? VIEWS.wide : VIEWS.close;
    const viewKey = isWide ? 'wide' : 'close';
    if (!this.views[viewKey]) {
      this.views[viewKey] = { backdrop: background(view, isWide), vignette: stageVignette(view, isWide) };
    }
    const { backdrop, vignette } = this.views[viewKey];
    const ctx = this.ctx;
    ctx.setTransform(this.canvas.width / WIDTH, 0, 0, this.canvas.height / HEIGHT, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(backdrop, 0, 0);

    const scale = clamp(Number(shadowSize) || 1, 0.55, 1.45);
    const edge = clamp(Number(softness) || 0, 0, 2);
    const progress = clamp(Number(drop) || 0);
    let dimensions = mediaSize(mask);
    let shadow = null;
    let performerBounds = normalizeBounds(bounds);
    if (dimensions) {
      shadow = this.readMask(mask, dimensions, 30 - 6 * edge);
    } else if (demo) {
      dimensions = { width: this.demoCanvas.width, height: this.demoCanvas.height };
      performerBounds = { x: 0.21, y: 0.102, width: 0.58, height: 0.86 };
      demoDancer(this.demoCanvas, time, '#060d19');
      shadow = this.demoCanvas;
    }

    if (shadow && progress > 0.02) {
      const revealProjection = project(view, dimensions, performerBounds, scale, true);
      const cutOut = source ? this.cutOut(source, shadow) : null;
      ctx.save();
      ctx.globalAlpha = smooth(0.1, 0.57, progress);
      if (cutOut) {
        compositeAt(ctx, cutOut, revealProjection);
      } else if (demo) {
        ctx.filter = 'brightness(2.5)';
        compositeAt(ctx, shadow, revealProjection);
      }
      ctx.restore();
    }

    if (progress < 1) {
      const projection = shadow ? project(view, dimensions, performerBounds, scale) : null;
      this.paintCloth(view, progress, shadow, projection, edge);
    } else {
      ctx.save();
      ctx.globalAlpha = 0.24;
      this.paintCloth(view, 1, null, null, 0);
      ctx.restore();
    }

    ctx.drawImage(vignette, 0, 0);
  }
}
