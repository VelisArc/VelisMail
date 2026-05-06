import { useEffect, useRef } from 'react';
import type { BufferGeometry, Material, Mesh, Object3D } from 'three';

export default function HomeOpsScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cleanup = () => {};
    let disposed = false;

    import('three').then((THREE) => {
      if (disposed || !hostRef.current) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0.15, 0.25, 7.2);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
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

      const core = new THREE.Group();
      root.add(core);

      const plateMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.08,
        roughness: 0.22,
        transparent: true,
        opacity: 0.36,
        side: THREE.DoubleSide,
      });
      const envelopePlate = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 1.42), plateMaterial);
      envelopePlate.rotation.x = -0.16;
      core.add(envelopePlate);

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

      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.52, 32, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }),
      );
      glow.position.set(0.52, 0.06, 0.18);
      core.add(glow);

      const routeMaterials = [
        new THREE.LineBasicMaterial({ color: 0xd87300, transparent: true, opacity: 0.68 }),
        new THREE.LineBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.58 }),
        new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.42 }),
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
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(96));
        root.add(new THREE.Line(geometry, routeMaterials[index]));
      });

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
      [
        [-3.05, -0.7, -0.5],
        [-2.7, 1.15, -0.35],
        [-1.4, -1.35, 0.22],
        [2.45, 1.45, -0.3],
        [3.1, -0.24, -0.45],
        [2.25, -1.25, 0.1],
      ].forEach((position, index) => {
        const node = new THREE.Mesh(nodeGeometry, index % 2 === 0 ? activeMaterial : nodeMaterial);
        node.position.set(position[0], position[1], position[2]);
        nodes.push(node);
        root.add(node);
      });

      const particlePositions = new Float32Array(120 * 3);
      for (let index = 0; index < particlePositions.length; index += 3) {
        particlePositions[index] = (Math.random() - 0.5) * 7.2;
        particlePositions[index + 1] = (Math.random() - 0.5) * 4.2;
        particlePositions[index + 2] = (Math.random() - 0.5) * 1.6;
      }
      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
      const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({ color: 0xd87300, size: 0.025, transparent: true, opacity: 0.42 }),
      );
      root.add(particles);

      scene.add(new THREE.AmbientLight(0xffffff, 1.65));
      const keyLight = new THREE.PointLight(0xffffff, 38, 12);
      keyLight.position.set(2.4, 3.4, 4.2);
      scene.add(keyLight);

      const resize = () => {
        const rect = host.getBoundingClientRect();
        const width = Math.max(rect.width, 320);
        const height = Math.max(rect.height, 300);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      let frame = 0;
      let raf = 0;
      const animate = () => {
        frame += 0.012;
        root.rotation.y = Math.sin(frame * 0.52) * 0.18;
        root.rotation.x = Math.sin(frame * 0.34) * 0.06;
        core.rotation.z = Math.sin(frame * 0.7) * 0.025;
        glow.scale.setScalar(1 + Math.sin(frame * 4) * 0.06);
        routeMaterials.forEach((material, index) => {
          material.opacity = 0.42 + Math.sin(frame * 2.1 + index) * 0.16;
        });
        nodes.forEach((node, index) => {
          node.scale.setScalar(1 + Math.sin(frame * 3.4 + index) * 0.18);
        });
        particles.rotation.z += 0.0009;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      };

      resize();
      animate();
      window.addEventListener('resize', resize);

      cleanup = () => {
        window.removeEventListener('resize', resize);
        cancelAnimationFrame(raf);
        disposeObject(root);
        renderer.dispose();
        if (host.contains(renderer.domElement)) {
          host.removeChild(renderer.domElement);
        }
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div className="hero-ops-scene" ref={hostRef} aria-hidden="true" />;
}
