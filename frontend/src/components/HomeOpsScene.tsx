import { useEffect, useRef } from 'react';
import type { Mesh } from 'three';

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
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      camera.position.set(0, 0.8, 7);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      host.appendChild(renderer.domElement);

      const group = new THREE.Group();
      scene.add(group);

      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xd87300,
        transparent: true,
        opacity: 0.28,
        wireframe: true,
      });
      const coreMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xd87300,
        emissiveIntensity: 0.18,
        metalness: 0.35,
        roughness: 0.42,
        transparent: true,
        opacity: 0.92,
      });
      const nodeMaterial = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        emissive: 0x2dd4bf,
        emissiveIntensity: 0.22,
        metalness: 0.15,
        roughness: 0.35,
      });

      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), coreMaterial);
      group.add(core);

      [1.9, 2.55, 3.1].forEach((radius, index) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 8, 120), ringMaterial);
        ring.rotation.x = Math.PI / (2.8 + index * 0.25);
        ring.rotation.y = index * 0.55;
        group.add(ring);
      });

      const nodes: Mesh[] = [];
      const nodeGeometry = new THREE.BoxGeometry(0.34, 0.34, 0.34);
      for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2;
        const radius = index % 2 === 0 ? 2.65 : 3.25;
        const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
        node.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.8, Math.sin(angle) * radius * 0.34);
        node.rotation.set(index * 0.4, index * 0.25, 0);
        nodes.push(node);
        group.add(node);
      }

      const light = new THREE.PointLight(0xffffff, 55, 18);
      light.position.set(2.8, 4, 4);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0xffffff, 1.8));

      const resize = () => {
        const rect = host.getBoundingClientRect();
        const width = Math.max(rect.width, 320);
        const height = Math.max(rect.height, 320);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      let frame = 0;
      let raf = 0;
      const animate = () => {
        frame += 0.01;
        group.rotation.y = frame * 0.55;
        group.rotation.x = Math.sin(frame * 0.8) * 0.12;
        core.rotation.x += 0.006;
        core.rotation.z -= 0.004;
        nodes.forEach((node, index) => {
          node.rotation.x += 0.01 + index * 0.0008;
          node.rotation.y -= 0.008;
        });
        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      };

      resize();
      animate();
      window.addEventListener('resize', resize);

      cleanup = () => {
        window.removeEventListener('resize', resize);
        cancelAnimationFrame(raf);
        renderer.dispose();
        ringMaterial.dispose();
        coreMaterial.dispose();
        nodeMaterial.dispose();
        nodeGeometry.dispose();
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

  return (
    <div className="hero-ops-scene" ref={hostRef} aria-hidden="true">
      <div className="hero-ops-caption">
        <span>Live Mail Ops</span>
        <strong>Private DB sync</strong>
      </div>
    </div>
  );
}
