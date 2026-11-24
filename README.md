# Henry’s Shadow Stage

Turn a dance video into a giant silhouette on a backlit curtain. Pick a close-up or wide shot, set a curtain-drop cue, and save the result with optional clip sound.

## Run it

Open [Henry’s Shadow Stage](https://craigwrenasmir.github.io/henrys-shadow-stage/) in a current browser. To work on the source locally, serve this directory over HTTP and open it in the browser. For example, run `python3 -m http.server 8796 --bind 127.0.0.1` here.

The page uses a bundled MediaPipe person-segmentation model. Video frames are processed on the device, and the browser records the finished composite. An MP4 is offered when the browser supports MP4 recording, with WebM available on supported browsers as a fallback. Keep the tab in view while it records.

The bundled demo is an excerpt of [Monochrome Video of Person Dancing](https://www.pexels.com/video/monochrome-video-of-person-dancing-857070/), uploaded by Vimeo to Pexels under [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
