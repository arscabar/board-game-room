import { useEffect, useRef } from "react";

export type ClubWorldMode = "home" | "lobby" | "play";

type ClubWorldCanvasProps = {
  mode: ClubWorldMode;
  accent?: string;
};

type FloatingPiece = {
  object: import("three").Object3D;
  baseY: number;
  phase: number;
  speed: number;
  spin: number;
};

export function ClubWorldCanvas({ mode, accent = "#d6ad62" }: ClubWorldCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    let disposed = false;
    let disposeScene = () => undefined;

    void import("three").then((THREE) => {
      if (disposed || !hostRef.current) {
        return;
      }

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: window.innerWidth > 640,
        powerPreference: "high-performance"
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = mode === "play" ? 0.82 : 1.05;
      renderer.domElement.className = "club-world-webgl";
      renderer.domElement.dataset.scene = mode;
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(mode === "play" ? 0x071813 : 0x061d17, mode === "home" ? 0.055 : 0.065);

      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
      const cameraBase = mode === "home"
        ? { x: 0, y: 4.7, z: 10.6 }
        : mode === "lobby"
          ? { x: 0.4, y: 4.2, z: 9.2 }
          : { x: -0.3, y: 4.9, z: 10.8 };
      camera.position.set(cameraBase.x, cameraBase.y, cameraBase.z);
      camera.lookAt(0, -0.45, 0);

      const root = new THREE.Group();
      root.position.set(mode === "lobby" ? -0.8 : 0, mode === "play" ? -1.45 : -1.05, mode === "home" ? -0.8 : -1.5);
      root.rotation.x = mode === "play" ? -0.06 : -0.12;
      scene.add(root);

      const accentColor = new THREE.Color(accent);
      const brass = new THREE.Color("#d6ad62");
      const ivory = new THREE.Color("#f2e8cf");
      const crimson = new THREE.Color("#a5414d");
      const cyan = new THREE.Color("#45b7aa");

      scene.add(new THREE.HemisphereLight(0xd9f6e8, 0x1c0908, mode === "play" ? 0.72 : 1.05));
      scene.add(new THREE.AmbientLight(0xf4dcc0, mode === "play" ? 0.28 : 0.42));

      const keyLight = new THREE.PointLight(brass, mode === "play" ? 22 : 34, 24, 1.5);
      keyLight.position.set(-4.8, 6.5, 5.4);
      scene.add(keyLight);

      const rimLight = new THREE.PointLight(accentColor, mode === "home" ? 26 : 20, 22, 1.7);
      rimLight.position.set(5.6, 2.8, -1.5);
      scene.add(rimLight);

      const tableMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x133f33,
        metalness: 0.08,
        roughness: 0.82,
        clearcoat: 0.18,
        transparent: true,
        opacity: mode === "play" ? 0.36 : 0.68
      });
      const table = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.45, 0.38, 72), tableMaterial);
      table.position.y = -0.72;
      table.scale.x = 1.34;
      root.add(table);

      const railMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x5f321f,
        metalness: 0.24,
        roughness: 0.42,
        clearcoat: 0.62,
        transparent: true,
        opacity: mode === "play" ? 0.48 : 0.84
      });
      const rail = new THREE.Mesh(new THREE.TorusGeometry(5.28, 0.16, 12, 96), railMaterial);
      rail.rotation.x = Math.PI / 2;
      rail.scale.x = 1.34;
      rail.position.y = -0.48;
      root.add(rail);

      const brassRail = new THREE.Mesh(
        new THREE.TorusGeometry(4.82, 0.028, 8, 96),
        new THREE.MeshBasicMaterial({ color: brass, transparent: true, opacity: mode === "play" ? 0.3 : 0.72 })
      );
      brassRail.rotation.x = Math.PI / 2;
      brassRail.scale.x = 1.34;
      brassRail.position.y = -0.43;
      root.add(brassRail);

      const grid = new THREE.GridHelper(28, 28, 0x8a7042, 0x315b50);
      grid.position.y = -0.9;
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach((material) => {
        material.transparent = true;
        material.opacity = mode === "play" ? 0.08 : 0.17;
      });
      root.add(grid);

      const floatingPieces: FloatingPiece[] = [];

      function track(object: import("three").Object3D, speed: number, spin: number, phase: number) {
        root.add(object);
        floatingPieces.push({ object, baseY: object.position.y, phase, speed, spin });
      }

      const tokenMaterials = [
        new THREE.MeshPhysicalMaterial({ color: accentColor, metalness: 0.25, roughness: 0.28, clearcoat: 0.7 }),
        new THREE.MeshPhysicalMaterial({ color: brass, metalness: 0.58, roughness: 0.25, clearcoat: 0.74 }),
        new THREE.MeshPhysicalMaterial({ color: crimson, metalness: 0.18, roughness: 0.34, clearcoat: 0.6 }),
        new THREE.MeshPhysicalMaterial({ color: cyan, metalness: 0.2, roughness: 0.3, clearcoat: 0.68 })
      ];

      const dieGeometry = new THREE.BoxGeometry(0.72, 0.72, 0.72, 2, 2, 2);
      const dieMaterial = new THREE.MeshPhysicalMaterial({ color: ivory, roughness: 0.24, clearcoat: 0.74 });
      const diePositions = mode === "lobby"
        ? [[-5.7, 0.35, -1.2], [5.4, 0.1, 1.1]]
        : [[-5.9, 0.25, -2.4], [5.8, 0.55, -0.8], [3.9, -0.1, 3.2]];
      diePositions.forEach(([x, y, z], index) => {
        const die = new THREE.Mesh(dieGeometry, dieMaterial);
        die.position.set(x, y, z);
        die.rotation.set(0.32 + index * 0.2, 0.55 - index * 0.16, 0.18);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(dieGeometry),
          new THREE.LineBasicMaterial({ color: 0x6b583e, transparent: true, opacity: 0.42 })
        );
        die.add(edges);
        track(die, 0.7 + index * 0.12, 0.16 + index * 0.04, index * 1.7);
      });

      const cardGeometry = new THREE.BoxGeometry(2.15, 0.12, 1.36);
      const cardPositions = [[-4.7, -0.16, 2.7], [4.9, -0.2, -2.8]];
      cardPositions.forEach(([x, y, z], index) => {
        const stack = new THREE.Group();
        for (let layer = 0; layer < 3; layer += 1) {
          const card = new THREE.Mesh(cardGeometry, tokenMaterials[(index + layer) % tokenMaterials.length]);
          card.position.y = layer * 0.13;
          card.rotation.y = layer * 0.055;
          stack.add(card);
        }
        stack.position.set(x, y, z);
        stack.rotation.y = index === 0 ? 0.52 : -0.46;
        track(stack, 0.48 + index * 0.1, index === 0 ? 0.035 : -0.03, 2.4 + index);
      });

      const ringGeometry = new THREE.TorusGeometry(0.58, 0.12, 14, 48);
      [[-2.8, 0.05, -3.9], [3.1, 0.36, -3.7], [5.4, 0.12, 2.8]].forEach(([x, y, z], index) => {
        const ring = new THREE.Mesh(ringGeometry, tokenMaterials[(index + 1) % tokenMaterials.length]);
        ring.position.set(x, y, z);
        ring.rotation.set(Math.PI / 2.7, index * 0.8, index * 0.24);
        track(ring, 0.62 + index * 0.08, index % 2 === 0 ? 0.11 : -0.09, index * 2.2);
      });

      function createPawn(material: import("three").Material) {
        const pawn = new THREE.Group();
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), material);
        head.position.y = 0.72;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.48, 0.72, 28), material);
        body.position.y = 0.23;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 28), material);
        base.position.y = -0.2;
        pawn.add(head, body, base);
        return pawn;
      }

      [[-6.1, -0.14, 1.1], [6.0, -0.12, -0.1], [0.5, 0.1, -4.5]].forEach(([x, y, z], index) => {
        const pawn = createPawn(tokenMaterials[index % tokenMaterials.length]);
        pawn.position.set(x, y, z);
        pawn.scale.setScalar(index === 2 ? 0.75 : 1);
        track(pawn, 0.54 + index * 0.09, index % 2 === 0 ? 0.08 : -0.07, index * 1.3);
      });

      const dustGeometry = new THREE.BufferGeometry();
      const dustCount = window.innerWidth < 640 ? 80 : 150;
      const dustPositions = new Float32Array(dustCount * 3);
      for (let index = 0; index < dustCount; index += 1) {
        const radius = 5.8 + ((index * 37) % 100) / 18;
        const angle = index * 2.399;
        dustPositions[index * 3] = Math.cos(angle) * radius;
        dustPositions[index * 3 + 1] = -0.6 + ((index * 17) % 100) / 34;
        dustPositions[index * 3 + 2] = Math.sin(angle) * radius;
      }
      dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
      const dust = new THREE.Points(
        dustGeometry,
        new THREE.PointsMaterial({ color: brass, size: 0.045, transparent: true, opacity: mode === "play" ? 0.18 : 0.42, sizeAttenuation: true })
      );
      root.add(dust);

      let pointerX = 0;
      let pointerY = 0;
      let frame = 0;
      let isVisible = !document.hidden;
      const timer = new THREE.Timer();
      timer.connect(document);

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        const mobile = width < 720;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.05 : 1.35));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.fov = mobile ? 52 : 42;
        camera.updateProjectionMatrix();
        if (reducedMotion.matches) {
          renderer.render(scene, camera);
          host.dataset.rendered = "true";
        }
      };

      const onPointerMove = (event: PointerEvent) => {
        pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
        pointerY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
        document.documentElement.style.setProperty("--club-pointer-x", pointerX.toFixed(3));
        document.documentElement.style.setProperty("--club-pointer-y", pointerY.toFixed(3));
        document.documentElement.style.setProperty("--club-tilt-x", `${(pointerX * 2.4).toFixed(2)}deg`);
        document.documentElement.style.setProperty("--club-tilt-y", `${(pointerY * -1.8).toFixed(2)}deg`);
        document.documentElement.style.setProperty("--club-shift-x", `${(pointerX * 9).toFixed(2)}px`);
        document.documentElement.style.setProperty("--club-shift-y", `${(pointerY * 7).toFixed(2)}px`);
      };

      const onVisibilityChange = () => {
        isVisible = !document.hidden;
        if (isVisible) {
          timer.reset();
        }
      };

      const render = (timestamp?: number) => {
        timer.update(timestamp);
        const elapsed = timer.getElapsed();
        const allowMotion = !reducedMotion.matches;
        if (allowMotion) {
          floatingPieces.forEach((piece) => {
            piece.object.position.y = piece.baseY + Math.sin(elapsed * piece.speed + piece.phase) * 0.13;
            piece.object.rotation.y += piece.spin * 0.008;
          });
          dust.rotation.y = elapsed * 0.018;
          const targetX = cameraBase.x + pointerX * (mode === "play" ? 0.18 : 0.46);
          const targetY = cameraBase.y - pointerY * (mode === "play" ? 0.08 : 0.22);
          camera.position.x += (targetX - camera.position.x) * 0.035;
          camera.position.y += (targetY - camera.position.y) * 0.035;
          root.rotation.z += ((pointerX * 0.012) - root.rotation.z) * 0.025;
          keyLight.position.x = -4.8 + pointerX * 1.2;
          rimLight.position.y = 2.8 - pointerY * 0.8;
          camera.lookAt(0, -0.45, 0);
        }
        if (isVisible) {
          renderer.render(scene, camera);
          host.dataset.rendered = "true";
        }
        frame = allowMotion ? window.requestAnimationFrame(render) : 0;
      };

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("visibilitychange", onVisibilityChange);
      resize();
      render();

      disposeScene = () => {
        window.cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        window.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        timer.dispose();
        document.documentElement.style.removeProperty("--club-pointer-x");
        document.documentElement.style.removeProperty("--club-pointer-y");
        document.documentElement.style.removeProperty("--club-tilt-x");
        document.documentElement.style.removeProperty("--club-tilt-y");
        document.documentElement.style.removeProperty("--club-shift-x");
        document.documentElement.style.removeProperty("--club-shift-y");
        scene.traverse((object) => {
          const mesh = object as import("three").Mesh;
          mesh.geometry?.dispose?.();
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          materials.forEach((material) => material.dispose());
        });
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    }).catch(() => {
      host.dataset.rendered = "fallback";
    });

    return () => {
      disposed = true;
      disposeScene();
    };
  }, [accent, mode]);

  return <div className={`club-world-canvas club-world-${mode}`} data-mode={mode} ref={hostRef} aria-hidden="true" />;
}

export default ClubWorldCanvas;
