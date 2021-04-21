const {Controller} = require('./controller');

class ThreeARContainer {
  constructor(container, {imageTargetSrc}) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.dimensions = null;
    this.anchors = [];
    this.imageTargetSrc = imageTargetSrc;
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
  }

  getComponents() {
    return {
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
    }
  }

  start() {
    const _start = async () => {
      const {container} = this;

      try {
	const {input, inputWidth, inputHeight} = await this._startVideo();
	this.input = input;
	this.inputWidth = inputWidth;
	this.inputHeight = inputHeight;
      } catch (e) {
	this.container.dispatchEvent(new CustomEvent("arError", {detail: {error: 'VIDEO_FAIL'}}));
	return;
      }

      try {
	const {controller, dimensions} = await this._startAR();
	this.controller = controller;
	this.dimensions = dimensions;
	await this.controller.dummyRun(this.input);
      } catch (e) {
	console.log("ar fail", e);
	this.container.dispatchEvent(new CustomEvent("arError", {detail: {error: 'AR_FAIL'}}));
	return;
      }

      this.container.appendChild(this.input);
      this.container.appendChild(this.renderer.domElement);

      this._recomputeSizes();

      container.dispatchEvent(new CustomEvent("arReady"));
      this.controller.processVideo(this.input);
    }
    _start();
  }

  stop() {
    const video = this.input;
    this.pause();
    const tracks = video.srcObject.getTracks();
    tracks.forEach(function(track) {
      track.stop();
    });
    video.remove();
  }
  pause(keepVideo=false) {
    const video = this.input;
    if (!keepVideo) {
      video.pause && video.pause();
    }
    this.controller.stopProcessVideo();
  }
  unpause() {
    const video = this.input;
    video.play();
    this.controller.processVideo(video);
  }

  createAnchor(targetIndex) {
    const [markerWidth, markerHeight] = this.dimensions[targetIndex];
    const position = new AFRAME.THREE.Vector3();
    const quaternion = new AFRAME.THREE.Quaternion();
    const scale = new AFRAME.THREE.Vector3();
    position.x = markerWidth / 2;
    position.y = markerWidth / 2 + (markerHeight - markerWidth) / 2;
    scale.x = markerWidth;
    scale.y = markerWidth;
    scale.z = markerWidth;
    const postMatrix = new AFRAME.THREE.Matrix4();
    postMatrix.compose(position, quaternion, scale);

    const anchor = new THREE.Group();
    anchor.visible = false;
    this.scene.add(anchor);
    anchor.matrixAutoUpdate = false;
    this.anchors.push({
      targetIndex,
      postMatrix,
      anchor
    });
    return anchor;
  }

  _startVideo() {
    return new Promise(async (resolve, reject) => {
      const video = document.createElement('video');
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
	console.log("missing navigator.mediaDevices.getUserMedia");
	reject();
	return;
      }

      navigator.mediaDevices.getUserMedia({audio: false, video: {
	facingMode: 'environment',
      }}).then((stream) => {
	video.addEventListener( 'loadedmetadata', () => {
	  resolve({input: video, inputWidth: video.videoWidth, inputHeight: video.videoHeight});
	});
	video.srcObject = stream;
      }).catch((err) => {
	console.log("getUserMedia error", err);
	reject();
      });

    });
  }

  _startAR() {
    return new Promise(async (resolve, reject) => {
      const {input, inputWidth, inputHeight} = this;
      const controller = new Controller({inputWidth, inputHeight, maxTrack:1, onUpdate: (data) => {
	if (data.type === 'updateMatrix') {
	  const {targetIndex, worldMatrix} = data;
	  this._updateAnchor({targetIndex, worldMatrix});
	}
      }});
      const {dimensions} = await controller.addImageTargets(this.imageTargetSrc);
      resolve({controller, dimensions});
    });
  }

  _recomputeSizes() {
    const {container, controller, camera, inputWidth, inputHeight, renderer, input} = this;

    const proj = controller.getProjectionMatrix();
    const fov = 2 * Math.atan(1/proj[5]) * 180 / Math.PI; // vertical fov
    const near = proj[14] / (proj[10] - 1.0);
    const far = proj[14] / (proj[10] + 1.0);
    const ratio = proj[5] / proj[0]; // (r-l) / (t-b)
    const newAspect = inputWidth / inputHeight;
    camera.fov = fov;
    camera.aspect = newAspect;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();

    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(inputWidth, inputHeight, false);

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    let displayWidth, displayHeight; // input and canvas - display css width, height
    const inputRatio = inputWidth / inputHeight;
    const containerRatio = containerWidth / containerHeight; 
    if (inputRatio > containerRatio) {
      displayHeight = container.clientHeight;
      displayWidth = displayHeight * inputRatio;
    } else {
      displayWidth = container.clientWidth;
      displayHeight = displayWidth / inputRatio;
    }

    const displayTopCss = (-(displayHeight - containerHeight) / 2) + "px";
    const displayLeftCss = (-(displayWidth - containerWidth) / 2) + "px";
    const displayWidthCss = displayWidth + "px";
    const displayHeightCss = displayHeight + "px";

    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.left = displayLeftCss;
    canvas.style.top = displayTopCss;
    canvas.style.width = displayWidthCss;
    canvas.style.height = displayHeightCss;
    input.style.position = 'absolute';
    input.style.left = displayLeftCss;
    input.style.top = displayTopCss;
    input.style.width = displayWidthCss;
    input.style.height = displayHeightCss;
  }

  _updateAnchor({targetIndex, worldMatrix}) {
    this.anchors.forEach(({targetIndex: anchorTargetIndex, postMatrix, anchor}) => {
      if (targetIndex === anchorTargetIndex) {
	if (worldMatrix) {
	  const m = new THREE.Matrix4();
	  m.elements = worldMatrix;
	  m.multiply(postMatrix);
	  anchor.matrix = m;
	  if (!anchor.visible) {
	    this.container.dispatchEvent(new CustomEvent("targetFound", {detail: {targetIndex}}));
	  }
	  anchor.visible = true;
	} else {
	  if (anchor.visible) {
	    this.container.dispatchEvent(new CustomEvent("targetLost", {detail: {targetIndex}}));
	  }
	  anchor.visible = false;
	}
      }
    });
  }
}

module.exports = {
  ThreeARContainer
}
