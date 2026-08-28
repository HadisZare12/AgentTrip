(function () {
  const canvas = document.getElementById('hero-globe-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const MODEL_PATH = '/static/models/globe.glb';
  const TARGET_SIZE = 4.5;      // world-unit size the model is scaled to fit
  const ROTATE_SPEED = 0.15;    // radians/sec

  const container = canvas.parentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 8);

  scene.add(new THREE.AmbientLight(0x3a4570, 1.1));
  const keyLight = new THREE.DirectionalLight(0xff8a4c, 1.4);
  keyLight.position.set(4, 3, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x5eead4, 1.0);
  rimLight.position.set(-4, -2, -3);
  scene.add(rimLight);

  let model = null;

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function fitAndCenter(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    object.position.sub(center); // center at origin
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = TARGET_SIZE / maxDim;
    object.scale.setScalar(scale);
  }

  fetch(MODEL_PATH, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok || typeof THREE.GLTFLoader === 'undefined') throw new Error('not found');
      const loader = new THREE.GLTFLoader();
      loader.load(
        MODEL_PATH,
        (gltf) => {
          model = gltf.scene;
          fitAndCenter(model);
          scene.add(model);
          resize();
        },
        undefined,
        () => showPlaceholder()
      );
    })
    .catch(() => showPlaceholder());

  function showPlaceholder() {
    container.classList.add('hero-globe-placeholder');
    const note = document.createElement('div');
    note.className = 'placeholder-inner';
    note.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9z"/></svg>
      <p>Add your model at<br><code>static/models/globe.glb</code></p>`;
    container.appendChild(note);
  }

  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    if (model && !reduceMotion) {
      model.rotation.y += clock.getDelta() * ROTATE_SPEED * 6;
    } else {
      clock.getDelta();
    }
    renderer.render(scene, camera);
  }
  animate();
})();