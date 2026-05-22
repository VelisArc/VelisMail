import { useEffect, useRef } from 'react';
import type { BufferGeometry, Material, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';

export default function HomeOpsScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cleanup = () => {};
    let disposed = false;

    const renderFallback = () => {
      if (!hostRef.current || hostRef.current.querySelector('.hero-ops-fallback')) return;
      const fallback = document.createElement('div');
      fallback.className = 'hero-ops-fallback';
      fallback.innerHTML = '<span></span><span></span><span></span><span></span>';
      hostRef.current.appendChild(fallback);
      cleanup = () => {
        if (hostRef.current?.contains(fallback)) {
          hostRef.current.removeChild(fallback);
        }
      };
    };

    const probeCanvas = document.createElement('canvas');
    const webglContext = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!webglContext) {
      renderFallback();
      return;
    }

    import('three').then((THREE) => {
      if (disposed || !hostRef.current) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0.15, 0.25, 7.2);

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
        });
      } catch {
        renderFallback();
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      host.appendChild(renderer.domElement);

      const root = new THREE.Group();
      scene.add(root);

      const disposeObject = (object: Object3D) => {
        object.traverse((child) => {
          const mesh = child as Mesh & { material?: Material | Material[]; geometry?: BufferGeometry };
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => material.dispose());
          } else {
            mesh.material?.dispose();
          }
        });
      };

      // ---- Central Core (Envelope) ----
      const core = new THREE.Group();
      root.add(core);

      const plateMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.12,
        roughness: 0.18,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
      });
      const envelopePlate = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 1.42), plateMaterial);
      envelopePlate.rotation.x = -0.16;
      core.add(envelopePlate);

      // Inner glow plane for depth
      const innerGlowMat = new THREE.MeshBasicMaterial({
        color: 0xd87300,
        transparent: true,
        opacity: 0.04,
        side: THREE.DoubleSide,
      });
      const innerGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.15), innerGlowMat);
      innerGlow.rotation.x = -0.16;
      innerGlow.position.z = 0.02;
      core.add(innerGlow);

      // Envelope wireframe outline
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: 0xd87300,
        transparent: true,
        opacity: 0.9,
      });
      const outlinePoints = [
        -1.18, -0.71, 0.04, 1.18, -0.71, 0.04,
        1.18, -0.71, 0.04, 1.18, 0.71, 0.04,
        1.18, 0.71, 0.04, -1.18, 0.71, 0.04,
        -1.18, 0.71, 0.04, -1.18, -0.71, 0.04,
        -1.18, 0.71, 0.05, 0, -0.06, 0.09,
        0, -0.06, 0.09, 1.18, 0.71, 0.05,
        -1.18, -0.71, 0.05, 0, -0.06, 0.09,
        0, -0.06, 0.09, 1.18, -0.71, 0.05,
      ];
      const outlineGeometry = new THREE.BufferGeometry();
      outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePoints, 3));
      core.add(new THREE.LineSegments(outlineGeometry, outlineMaterial));

      // Central glow sphere with pulsing
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.52, 32, 32), glowMat);
      glow.position.set(0.52, 0.06, 0.18);
      core.add(glow);

      // Secondary accent glow
      const glow2Mat = new THREE.MeshBasicMaterial({ color: 0xd87300, transparent: true, opacity: 0.06 });
      const glow2 = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 32), glow2Mat);
      glow2.position.set(-0.3, 0.1, 0.1);
      core.add(glow2);

      // ---- Route curves with gradient-like animated dashes ----
      const routeMaterials = [
        new THREE.LineBasicMaterial({ color: 0xd87300, transparent: true, opacity: 0.68 }),
        new THREE.LineBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.58 }),
        new THREE.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.42 }),
      ];

      const curves = [
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-3.5, -0.55, -0.65),
          new THREE.Vector3(-1.75, 1.45, 0.1),
          new THREE.Vector3(0.2, 0.62, 0.28),
          new THREE.Vector3(2.95, 1.2, -0.42),
        ]),
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-3.1, 1.15, -0.35),
          new THREE.Vector3(-1.1, 0.1, 0.3),
          new THREE.Vector3(1.05, -0.82, 0.15),
          new THREE.Vector3(3.35, -0.15, -0.55),
        ]),
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-2.55, -1.75, -0.2),
          new THREE.Vector3(-0.8, -0.8, 0.44),
          new THREE.Vector3(1.2, 1.15, 0.12),
          new THREE.Vector3(2.65, 1.75, -0.35),
        ]),
      ];

      curves.forEach((curve, index) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(128));
        root.add(new THREE.Line(geometry, routeMaterials[index]));
      });

      // ---- Data packet particles travelling along curves ----
      const packetGeometry = new THREE.SphereGeometry(0.065, 12, 12);
      const packetMaterials = [
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9 }),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 }),
        new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.8 }),
      ];

      // Multiple packets per curve for busy network feel
      const packets: { mesh: Mesh; curve: InstanceType<typeof THREE.CatmullRomCurve3>; speed: number; offset: number }[] = [];
      curves.forEach((curve, ci) => {
        for (let p = 0; p < 3; p++) {
          const mesh = new THREE.Mesh(packetGeometry, packetMaterials[ci]);
          root.add(mesh);
          packets.push({
            mesh,
            curve,
            speed: 0.15 + Math.random() * 0.12,
            offset: p * 0.33 + Math.random() * 0.1,
          });
        }
      });

      // Packet trail glow (larger translucent sphere behind each packet)
      const trailGeometry = new THREE.SphereGeometry(0.16, 10, 10);
      const trailMaterials = [
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.15 }),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.12 }),
        new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.1 }),
      ];
      const trails: Mesh[] = [];
      packets.forEach((_pkt, i) => {
        const trail = new THREE.Mesh(trailGeometry, trailMaterials[i % 3]);
        root.add(trail);
        trails.push(trail);
      });

      // ---- Network nodes ----
      const nodeMaterial = new THREE.MeshStandardMaterial({
        color: 0x0f766e,
        emissive: 0x0f766e,
        emissiveIntensity: 0.35,
        roughness: 0.32,
        metalness: 0.18,
      });
      const activeMaterial = new THREE.MeshStandardMaterial({
        color: 0xd87300,
        emissive: 0xd87300,
        emissiveIntensity: 0.42,
        roughness: 0.28,
        metalness: 0.2,
      });
      const nodeGeometry = new THREE.SphereGeometry(0.15, 22, 22);
      const nodes: Mesh[] = [];
      const nodePositions = [
        [-3.05, -0.7, -0.5],
        [-2.7, 1.15, -0.35],
        [-1.4, -1.35, 0.22],
        [2.45, 1.45, -0.3],
        [3.1, -0.24, -0.45],
        [2.25, -1.25, 0.1],
      ];
      nodePositions.forEach((position, index) => {
        const node = new THREE.Mesh(nodeGeometry, index % 2 === 0 ? activeMaterial : nodeMaterial);
        node.position.set(position[0], position[1], position[2]);
        nodes.push(node);
        root.add(node);
      });

      // Node ring glow (animated halo around each node)
      const ringGeometry = new THREE.RingGeometry(0.2, 0.28, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xd87300,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      });
      const rings: Mesh[] = [];
      nodePositions.forEach((position) => {
        const ring = new THREE.Mesh(ringGeometry, ringMat.clone());
        ring.position.set(position[0], position[1], position[2] + 0.01);
        ring.lookAt(camera.position);
        root.add(ring);
        rings.push(ring);
      });

      // ---- Hexagonal grid background (subtle depth) ----
      const hexGridGroup = new THREE.Group();
      const hexMat = new THREE.LineBasicMaterial({
        color: 0xd87300,
        transparent: true,
        opacity: 0.035,
      });
      for (let hx = -4; hx <= 4; hx += 1.4) {
        for (let hy = -3; hy <= 3; hy += 1.2) {
          const offsetX = (Math.floor(hy / 1.2) % 2) * 0.7;
          const hexPoints: Vector3[] = [];
          for (let a = 0; a < 7; a++) {
            const angle = (a / 6) * Math.PI * 2;
            hexPoints.push(new THREE.Vector3(
              hx + offsetX + Math.cos(angle) * 0.55,
              hy + Math.sin(angle) * 0.55,
              -1.5
            ));
          }
          const hexGeo = new THREE.BufferGeometry().setFromPoints(hexPoints);
          hexGridGroup.add(new THREE.Line(hexGeo, hexMat));
        }
      }
      root.add(hexGridGroup);

      // ---- Orbiting shield ring ----
      const orbitRingGeo = new THREE.TorusGeometry(2.8, 0.012, 8, 128);
      const orbitRingMat = new THREE.MeshBasicMaterial({
        color: 0x0f766e,
        transparent: true,
        opacity: 0.18,
      });
      const orbitRing = new THREE.Mesh(orbitRingGeo, orbitRingMat);
      orbitRing.rotation.x = Math.PI * 0.42;
      orbitRing.rotation.y = 0.3;
      root.add(orbitRing);

      // Second orbit ring
      const orbitRing2 = new THREE.Mesh(
        new THREE.TorusGeometry(3.2, 0.008, 8, 128),
        new THREE.MeshBasicMaterial({ color: 0xd87300, transparent: true, opacity: 0.1 })
      );
      orbitRing2.rotation.x = Math.PI * 0.55;
      orbitRing2.rotation.y = -0.2;
      root.add(orbitRing2);

      // ---- Field particles ----
      const particleCount = 180;
      const particlePositions = new Float32Array(particleCount * 3);
      const particleSizes = new Float32Array(particleCount);
      for (let index = 0; index < particleCount; index++) {
        particlePositions[index * 3] = (Math.random() - 0.5) * 8;
        particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 5;
        particlePositions[index * 3 + 2] = (Math.random() - 0.5) * 2;
        particleSizes[index] = 0.015 + Math.random() * 0.02;
      }
      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
      const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({
          color: 0xd87300,
          size: 0.028,
          transparent: true,
          opacity: 0.45,
          sizeAttenuation: true,
        }),
      );
      root.add(particles);

      // Secondary particle field (teal)
      const particleCount2 = 90;
      const particlePositions2 = new Float32Array(particleCount2 * 3);
      for (let i = 0; i < particleCount2; i++) {
        particlePositions2[i * 3] = (Math.random() - 0.5) * 9;
        particlePositions2[i * 3 + 1] = (Math.random() - 0.5) * 5.5;
        particlePositions2[i * 3 + 2] = (Math.random() - 0.5) * 2.5;
      }
      const particleGeo2 = new THREE.BufferGeometry();
      particleGeo2.setAttribute('position', new THREE.BufferAttribute(particlePositions2, 3));
      const particles2 = new THREE.Points(
        particleGeo2,
        new THREE.PointsMaterial({
          color: 0x0f766e,
          size: 0.022,
          transparent: true,
          opacity: 0.3,
          sizeAttenuation: true,
        }),
      );
      root.add(particles2);

      // ---- Lighting ----
      scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      const keyLight = new THREE.PointLight(0xffffff, 35, 14);
      keyLight.position.set(2.4, 3.4, 4.2);
      scene.add(keyLight);

      const rimLight = new THREE.PointLight(0xd87300, 12, 10);
      rimLight.position.set(-3, -1, 3);
      scene.add(rimLight);

      const topLight = new THREE.PointLight(0x0f766e, 8, 12);
      topLight.position.set(0, 4, 2);
      scene.add(topLight);

      // ---- Mouse interaction (subtle parallax) ----
      let mouseX = 0;
      let mouseY = 0;
      const onMouseMove = (e: MouseEvent) => {
        const rect = host.getBoundingClientRect();
        mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      };
      host.addEventListener('mousemove', onMouseMove);

      // ---- Resize handler ----
      const resize = () => {
        const rect = host.getBoundingClientRect();
        const width = Math.max(rect.width, 320);
        const height = Math.max(rect.height, 300);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      // ---- Animation loop ----
      let frame = 0;
      let raf = 0;
      const animate = () => {
        frame += 0.012;

        // Smooth rotation with mouse parallax
        const targetRotY = Math.sin(frame * 0.52) * 0.15 + mouseX * 0.08;
        const targetRotX = Math.sin(frame * 0.34) * 0.05 - mouseY * 0.04;
        root.rotation.y += (targetRotY - root.rotation.y) * 0.05;
        root.rotation.x += (targetRotX - root.rotation.x) * 0.05;

        // Core animations
        core.rotation.z = Math.sin(frame * 0.7) * 0.02;
        glow.scale.setScalar(1 + Math.sin(frame * 3.5) * 0.08);
        glowMat.opacity = 0.16 + Math.sin(frame * 3.5) * 0.06;
        glow2.scale.setScalar(1 + Math.sin(frame * 2.2 + 1) * 0.1);
        innerGlowMat.opacity = 0.03 + Math.sin(frame * 2) * 0.02;

        // Route material breathing
        routeMaterials.forEach((material, index) => {
          material.opacity = 0.42 + Math.sin(frame * 2.1 + index * 1.2) * 0.18;
        });

        // Node pulse
        nodes.forEach((node, index) => {
          const pulse = 1 + Math.sin(frame * 3 + index * 1.1) * 0.2;
          node.scale.setScalar(pulse);
        });

        // Ring halo animation
        rings.forEach((ring, index) => {
          const scale = 1 + Math.sin(frame * 2.5 + index * 0.8) * 0.3;
          ring.scale.setScalar(scale);
          const mat = ring.material as MeshBasicMaterial;
          mat.opacity = 0.1 + Math.sin(frame * 2.5 + index * 0.8) * 0.06;
          ring.lookAt(camera.position);
        });

        // Data packets travelling along curves
        packets.forEach((pkt, i) => {
          const t = ((frame * pkt.speed + pkt.offset) % 1 + 1) % 1;
          const pos = pkt.curve.getPointAt(t);
          pkt.mesh.position.copy(pos);
          // Pulsing scale
          pkt.mesh.scale.setScalar(0.8 + Math.sin(frame * 6 + i) * 0.3);
          // Trail follows
          trails[i].position.copy(pos);
          trails[i].scale.setScalar(1 + Math.sin(frame * 4 + i) * 0.2);
        });

        // Orbit ring rotation
        orbitRing.rotation.z = frame * 0.15;
        orbitRingMat.opacity = 0.14 + Math.sin(frame * 1.5) * 0.06;
        orbitRing2.rotation.z = -frame * 0.1;

        // Hex grid subtle drift
        hexGridGroup.position.x = Math.sin(frame * 0.2) * 0.15;
        hexGridGroup.position.y = Math.cos(frame * 0.15) * 0.1;

        // Particles
        particles.rotation.z += 0.0008;
        particles.rotation.y += 0.0003;
        particles2.rotation.z -= 0.0006;
        particles2.rotation.x += 0.0002;

        // Rim light color shift
        const rimHue = (frame * 0.08) % 1;
        rimLight.color.setHSL(rimHue * 0.1 + 0.07, 0.9, 0.5);

        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      };

      resize();
      animate();
      window.addEventListener('resize', resize);

      cleanup = () => {
        window.removeEventListener('resize', resize);
        host.removeEventListener('mousemove', onMouseMove);
        cancelAnimationFrame(raf);
        disposeObject(root);
        renderer.dispose();
        if (host.contains(renderer.domElement)) {
          host.removeChild(renderer.domElement);
        }
      };
    }).catch(renderFallback);

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div className="hero-ops-scene" ref={hostRef} aria-hidden="true" />;
}
