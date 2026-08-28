(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < 700;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.autoClear = false;

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0.5, 6.8);

  // =========================================================
  // BACKGROUND PASS — fullscreen flowing gradient shader
  // =========================================================
  const bgScene = new THREE.Scene();
  const bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0x0d1330) },
      uColorB: { value: new THREE.Color(0x1a1240) },
      uColorC: { value: new THREE.Color(0x2a1530) },
      uAccent: { value: new THREE.Color(0xff8a4c) },
      uAccent2: { value: new THREE.Color(0x5eead4) },
      uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC;
      uniform vec3 uAccent; uniform vec3 uAccent2;
      uniform vec2 uRes;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i+vec2(1.0,0.0));
        float c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0, amp = 0.55;
        for(int i=0;i<5;i++){ v += amp*noise(p); p *= 2.02; amp *= 0.55; }
        return v;
      }

      void main(){
        vec2 uv = vUv;
        vec2 asp = vec2(uRes.x/uRes.y, 1.0);
        vec2 p = (uv - 0.5) * asp;

        float t = uTime * 0.045;
        float n1 = fbm(p*1.6 + vec2(t, -t*0.7));
        float n2 = fbm(p*2.2 - vec2(t*0.8, t*0.5) + 4.0);

        vec3 base = mix(uColorA, uColorB, smoothstep(0.2,0.8,n1));
        base = mix(base, uColorC, smoothstep(0.3,0.9,n2)*0.6);

        float glowA = smoothstep(0.55, 0.95, n1) * 0.5;
        float glowB = smoothstep(0.6, 0.95, n2) * 0.4;
        base += uAccent * glowA * 0.35;
        base += uAccent2 * glowB * 0.3;

        float vign = 1.0 - smoothstep(0.4, 1.05, length(p));
        base *= mix(0.55, 1.0, vign);

        gl_FragColor = vec4(base, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false,
  });
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

  // =========================================================
  // MAIN SCENE
  // =========================================================
  const scene = new THREE.Scene();

  // ---- Lighting: real shading on the metallic orbit spheres ----
  scene.add(new THREE.AmbientLight(0x2a3560, 0.7));
  const lightAmber = new THREE.PointLight(0xff8a4c, 1.6, 20);
  lightAmber.position.set(3, 2, 4);
  scene.add(lightAmber);
  const lightTeal = new THREE.PointLight(0x5eead4, 1.3, 20);
  lightTeal.position.set(-3, -1.5, 3);
  scene.add(lightTeal);
  const lightViolet = new THREE.PointLight(0xa78bfa, 0.9, 18);
  lightViolet.position.set(0, 3, -2);
  scene.add(lightViolet);

  // ---- Starfield ----
  const starCount = isMobile ? 300 : 600;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 20 + Math.random() * 26;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPos[i * 3 + 2] = r * Math.cos(phi);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd0ff, size: 0.026, transparent: true, opacity: 0.55 })));

  // =========================================================
  // CENTERPIECE — colorful toy-style travel diorama
  // =========================================================
  const CENTER = new THREE.Group();
  CENTER.position.set(-1.6, -0.6, -3.2);
  CENTER.scale.setScalar(0.6);
  scene.add(CENTER);

  const toon = (color, opts = {}) => new THREE.MeshStandardMaterial({
    color, metalness: 0.15, roughness: 0.45, emissive: color, emissiveIntensity: 0.08, ...opts,
  });

  // ---- floating island base ----
  const island = new THREE.Group();
  const islandTop = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.7, 0.3, 40), toon(0xf2c96d, { roughness: 0.6 }));
  islandTop.position.y = 0;
  island.add(islandTop);
  const islandUnder = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.9, 40), toon(0x2a6f4f, { roughness: 0.8 }));
  islandUnder.position.y = -0.55;
  islandUnder.rotation.x = Math.PI;
  island.add(islandUnder);
  const sandRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.09, 16, 40), toon(0xffe3a8, { roughness: 0.7 }));
  sandRing.rotation.x = Math.PI / 2;
  sandRing.position.y = 0.16;
  island.add(sandRing);
  CENTER.add(island);

  // ---- palm tree ----
  function buildPalm() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.85, 8), toon(0x8a5a34, { roughness: 0.7 }));
    trunk.position.y = 0.42;
    trunk.rotation.z = 0.12;
    g.add(trunk);
    const frondMat = toon(0x3fae63, { roughness: 0.55 });
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 6), frondMat);
      frond.position.set(0, 0.85, 0);
      frond.rotation.z = (Math.PI / 2) - 0.35;
      frond.rotation.y = (i / 6) * Math.PI * 2;
      frond.translateY(0.27);
      g.add(frond);
    }
    return g;
  }
  const palm = buildPalm();
  palm.position.set(-0.65, 0.3, 0.5);
  palm.scale.setScalar(0.95);
  CENTER.add(palm);
  const palm2 = buildPalm();
  palm2.position.set(0.15, 0.3, 0.85);
  palm2.scale.setScalar(0.7);
  palm2.rotation.y = 1.4;
  CENTER.add(palm2);

  // ---- suitcase resting on the island ----
  function buildSuitcase(scale = 1) {
    const g = new THREE.Group();
    const bodyMat = toon(0xff8a4c, { roughness: 0.4, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.22), bodyMat);
    g.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.24), toon(0xffffff, { roughness: 0.5 }));
    g.add(stripe);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 16, Math.PI), toon(0x3a2a1e, { roughness: 0.6 }));
    handle.position.y = 0.26;
    g.add(handle);
    [-0.22, 0.22].forEach((x) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12), toon(0x232733, { roughness: 0.5 }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, -0.24, 0);
      g.add(wheel);
    });
    g.scale.setScalar(scale);
    return g;
  }
  const suitcase = buildSuitcase(0.85);
  suitcase.position.set(0.55, 0.5, -0.3);
  suitcase.rotation.y = -0.5;
  CENTER.add(suitcase);

  // ---- banking airplane, orbits the island ----
  function buildToyPlane() {
    const g = new THREE.Group();
    const bodyMat = toon(0xffffff, { roughness: 0.35, metalness: 0.1 });
    const accentMat = toon(0xff8a4c, { roughness: 0.35, metalness: 0.1 });
    const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.09, 0.5, 4, 8) : new THREE.CylinderGeometry(0.09, 0.09, 0.68, 12), bodyMat);
    fuselage.rotation.z = Math.PI / 2;
    g.add(fuselage);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 12), accentMat);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 0.42;
    g.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.14), accentMat);
    g.add(wing);
    const tailWing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.09), accentMat);
    tailWing.position.set(-0.28, 0.03, 0);
    g.add(tailWing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.02), accentMat);
    fin.position.set(-0.28, 0.09, 0);
    g.add(fin);
    return g;
  }
  const plane = buildToyPlane();
  plane.scale.setScalar(1.3);
  CENTER.add(plane);
  const planeOrbit = { radius: 2.5, speed: 0.22, tilt: 0.28, height: 0.9 };

  // ---- small floating travel icons around the diorama ----
  function buildCloud() {
    const g = new THREE.Group();
    const mat = toon(0xffffff, { roughness: 0.6 });
    [[0, 0, 0.09], [0.1, 0.03, 0.07], [-0.1, 0.03, 0.07], [0, -0.04, 0.08]].forEach((p) => {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(p[2], 10, 10), mat);
      puff.position.set(p[0], p[1], 0);
      g.add(puff);
    });
    return g;
  }
  function buildPin(color) {
    const g = new THREE.Group();
    const mat = toon(color, { roughness: 0.4 });
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 12), mat);
    point.rotation.x = Math.PI;
    point.position.y = -0.06;
    g.add(point);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), mat);
    head.position.y = 0.06;
    g.add(head);
    return g;
  }
  function buildCoin() {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 24), toon(0xffd166, { roughness: 0.3, metalness: 0.4 }));
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
    return g;
  }

  const floaters = [
    { mesh: buildCloud(), radius: 2.1, speed: 0.16, tilt: 0.55, phase: 0.4, height: 1.4 },
    { mesh: buildPin(0xa78bfa), radius: 1.9, speed: 0.24, tilt: -0.3, phase: 2.1, height: 0.5 },
    { mesh: buildCoin(), radius: 2.0, speed: 0.2, tilt: 0.15, phase: 4.0, height: 0.7 },
    { mesh: buildCloud(), radius: 2.3, speed: 0.13, tilt: -0.5, phase: 5.2, height: 1.6, scale: 0.7 },
  ];
  floaters.forEach((f) => {
    if (f.scale) f.mesh.scale.setScalar(f.scale);
    CENTER.add(f.mesh);
  });

  // ---- soft glow disc beneath the island (like a studio ground shadow) ----
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
  const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = -1.4;
  CENTER.add(shadowDisc);

  // ---- Shooting star streaks ----
  function makeStreak() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.9, 0, 0)]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    return {
      line,
      active: false,
      t: 0,
      dur: 0,
      start: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      speed: 0,
    };
  }
  const streaks = Array.from({ length: 7 }, makeStreak);
  function spawnStreak(s) {
    const side = Math.random() > 0.5 ? 1 : -1;
    s.start.set(side * 9, 4 + Math.random() * 3, -3 - Math.random() * 6);
    s.dir.set(-side * (0.7 + Math.random() * 0.3), -(0.5 + Math.random() * 0.4), Math.random() * 0.3).normalize();
    s.speed = 6 + Math.random() * 5;
    s.dur = 1.1 + Math.random() * 0.6;
    s.t = 0;
    s.active = true;
    s.line.material.color.setHex([0xff8a4c, 0x5eead4, 0xffffff, 0xa78bfa][Math.floor(Math.random() * 4)]);
  }
  let nextStreakAt = 1.5;

  let t = 0;
  let mouseX = 0, mouseY = 0;
  window.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  let revealed = false;
  const resultsEl = document.getElementById('results');
  if (resultsEl && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) revealed = true; }),
      { threshold: 0.15 }
    );
    io.observe(resultsEl);
  }

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (!reduceMotion) {
      t += dt;
      bgMat.uniforms.uTime.value = t;

      CENTER.rotation.y += dt * 0.07;
      CENTER.position.y = -0.1 + Math.sin(t * 0.4) * 0.06;

      // banking airplane orbiting the island
      const pa = t * planeOrbit.speed;
      const paNext = pa + 0.03;
      const ppos = new THREE.Vector3(
        Math.cos(pa) * planeOrbit.radius,
        planeOrbit.height + Math.sin(pa * 1.3) * 0.15,
        Math.sin(pa) * planeOrbit.radius * Math.cos(planeOrbit.tilt)
      );
      const pnext = new THREE.Vector3(
        Math.cos(paNext) * planeOrbit.radius,
        planeOrbit.height + Math.sin(paNext * 1.3) * 0.15,
        Math.sin(paNext) * planeOrbit.radius * Math.cos(planeOrbit.tilt)
      );
      plane.position.copy(ppos);
      plane.lookAt(pnext);

      // small floating icons drifting around the diorama
      floaters.forEach((f) => {
        const a = t * f.speed + f.phase;
        f.mesh.position.set(
          Math.cos(a) * f.radius,
          f.height + Math.sin(t * 0.6 + f.phase) * 0.12,
          Math.sin(a) * f.radius * Math.cos(f.tilt)
        );
        f.mesh.rotation.y += dt * 0.3;
      });

      lightAmber.position.x = 3 + Math.sin(t * 0.3) * 0.6;
      lightTeal.position.y = -1.5 + Math.cos(t * 0.25) * 0.6;

      // shooting stars
      nextStreakAt -= dt;
      if (nextStreakAt <= 0) {
        const idle = streaks.find((s) => !s.active);
        if (idle) spawnStreak(idle);
        nextStreakAt = 0.9 + Math.random() * 1.8;
      }
      streaks.forEach((s) => {
        if (!s.active) return;
        s.t += dt;
        const progress = s.t / s.dur;
        if (progress >= 1) { s.active = false; s.line.material.opacity = 0; return; }
        const headPos = s.start.clone().addScaledVector(s.dir, s.speed * s.t);
        const tailPos = headPos.clone().addScaledVector(s.dir, -0.9);
        const posAttr = s.line.geometry.attributes.position;
        posAttr.setXYZ(0, headPos.x, headPos.y, headPos.z);
        posAttr.setXYZ(1, tailPos.x, tailPos.y, tailPos.z);
        posAttr.needsUpdate = true;
        s.line.material.opacity = Math.sin(progress * Math.PI) * 0.85;
      });

      const camTargetZ = revealed ? 7.6 : 6.8;
      camera.position.z += (camTargetZ - camera.position.z) * 0.02;
      camera.position.x += (mouseX * 0.5 - camera.position.x) * 0.02;
      camera.position.y += (0.2 - mouseY * 0.3 - camera.position.y) * 0.02;
      camera.lookAt(0, 0, 0);
    }

    renderer.clear();
    renderer.render(bgScene, bgCamera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    bgMat.uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
  });
})();